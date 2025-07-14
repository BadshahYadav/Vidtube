import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.modules.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });
    return { accessToken, refreshToken };
  } catch (error) {
    console.error("Error generating tokens:", error);
    throw new ApiError(
      500,
      "Something went wrong while generating access and refresh tokens",
    );
  }
};

const registerUser = asyncHandler(async (req, res) => {
  // Log the incoming request for debugging
  // console.log("Request body:", req.body);
  // console.log("Request files:", req.files);

  const { fullname, username, email, password } = req.body;

  // Validations
  if (
    [fullname, username, email, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required");
  }

  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (existedUser) {
    throw new ApiError(
      409,
      "User with this email or this username already existed",
    );
  }

  console.warn("Request files:", req.files);
  const avatarLocalPath = req.files?.avatar?.[0]?.path;
  const coverLocalPath = req.files?.coverImage?.[0]?.path;

  // Temporarily make avatar optional for testing
  if (!avatarLocalPath) {
    console.log("No avatar file provided, using default");
    throw new ApiError(400, "Avatar file is missing");
  }

  let avatar;
  try {
    avatar = await uploadOnCloudinary(avatarLocalPath);
    console.log("Uploaded avatar Image", avatar);
  } catch (error) {
    console.log("Error during avatar upload:", error);
    throw new ApiError(500, "fail to upload avatar file");
  }

  let coverImage;
  try {
    coverImage = await uploadOnCloudinary(coverLocalPath);
  } catch (error) {
    console.log("Error during coverImage upload:", error);
    throw new ApiError(500, "fail to upload coverImage file");
  }

  try {
    const user = await User.create({
      fullname,
      username: username.toLowerCase(),
      avatar: avatar?.url || "",
      coverImage: coverImage?.url || "",
      email,
      password: password,
    });

    const createdUser = await User.findById(user._id).select(
      "-password -refreshToken",
    );

    if (!createdUser) {
      throw new ApiError(500, "Something went wrong while registering a user");
    }

    return res
      .status(200)
      .json(new ApiResponse(200, createdUser, "User registered successfully"));
  } catch (error) {
    console.error("User creation failed", error);
    if (avatar) {
      await deleteFromCloudinary(avatar?.public_id);
    }
    if (coverImage) {
      await deleteFromCloudinary(coverImage?.public_id);
    }

    throw new ApiError(
      500,
      "Something went wrong while registering a user and image were deleted from cloudinary",
    );
  }
});

const loginUser = asyncHandler(async (req, res) => {
  // get data from the user
  const { email, username, password } = req.body;

  // validation
  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Validate password
  const isPasswordValid = await user.isPasswordMatch(password);
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid credientials");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id,
  );

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken",
  );

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // Set secure flag in production
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken },
        "User logged in successfully",
      ),
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    // TODO: Implement logout functionality
    req.user._id,
    {
      $set: {
        refreshAccessToken: undefined,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // Set secure flag in production
  };

  return res
    .status(200)
    .cookie("accessToken", "", options)
    .cookie("refreshToken", "", options)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(400, "Refresh token is required");
  }

  try {
    const decodeToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET,
    );
    if (!decodeToken) {
      throw new ApiError(401, "Invalid refresh token");
    }
    const user = await User.findById(decodeToken?._id);
    if (!user) {
      throw new ApiError(401, "Invalid refresh token");
    }

    if (incomingRefreshToken !== user?.refreshToken) {
      throw new ApiError(401, "Invalid refresh token");
    }

    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // Set secure flag in production
    };
    const { accessToken, refreshToken: newRefreshToken } =
      await generateAccessAndRefreshTokens(user._id);

    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken },
          "Access token refreshed successfully",
        ),
      );
  } catch (error) {
    throw new ApiError(
      500,
      "something went wrong while refreshing access token",
    );
  }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // validation
  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "Current password and new password are required");
  }

  const user = await User.findById(req.user?._id);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Validate current password
  const isCurrentPasswordValid = await user.isPasswordMatch(currentPassword);
  if (!isCurrentPasswordValid) {
    throw new ApiError(401, "Invalid current password");
  }

  user.password = newPassword;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "Current user fetched successfully"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
  const { fullname, username, email } = req.body;
  // Validations
  if (!fullname || !username || !email) {
    throw new ApiError(400, "All fields are required");
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Check if username or email already exists
  const existedUser = await User.findOne({
    $or: [
      { username: username.toLowerCase(), _id: { $ne: user._id } },
      { email, _id: { $ne: user._id } },
    ],
  });

  if (existedUser) {
    throw new ApiError(409, "Username or email already exists");
  }

  user.fullname = fullname;
  user.username = username.toLowerCase();
  user.email = email.toLowerCase();
  await user.save();

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.files?.path;
  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required");
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);

  if (!avatar.url) {
    throw new ApiError(500, "Failed to upload avatar image");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.url,
      },
    },
    { new: true },
  ).select("-password -refreshToken");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Avatar updated successfully"));
});

const updateUserCoverImage = asyncHandler(async (req, res) => {
  const coverLocalPath = req.files?.path;

  if (!coverLocalPath) {
    throw new ApiError(400, "Cover Image file is required");
  }

  const coverImage = await uploadOnCloudinary(coverLocalPath);

  if (!coverImage.url) {
    throw new ApiError(500, "Failed to upload Cover Image");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        coverImage: coverImage.url,
      },
    },
    { new: true },
  ).select("-password -refreshToken");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Cover image updated successfully"));
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
  const { username } = req.params;
  if (!username?.trim()) {
    throw new ApiError(400, "Username is required");
  }

  const channel = await User.aggregate([
    {
      $match: {
        username: username?.toLowerCase(),
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "channel",
        as: "subscribers",
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscriberedTo",
      },
    },
    {
      $addFields: {
        subscribersCount: {
          $size: "$subscribers",
        },
        channelSubscribedToCount: {
          $size: "$subscriberedTo",
        },

        isSubscribed: {
          $cond: {
            if: { $in: [req.user?._id, "$subscribers.subscriber"] },
            then: true,
            else: false,
          }
        }
      }
    },
    {
        // Project only the necessary data
        $project: {
            _id: 1,
            fullname: 1,
            username: 1,
            email: 1,
            avatar: 1,
            coverImage: 1,
            subscribersCount: 1,
            channelSubscribedToCount: 1,
            isSubscribed: 1
        }
    }
  ]);

  if (!channel?.length) {
    throw new ApiError(404, "Channel not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, channel[0], "Channel fetched successfully"));
});

const getWatchHistory = asyncHandler(async (req, res) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user?._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: 
                [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: 
                            [
                                {
                                    $project: {
                                        fullname: 1,
                                        username: 1,
                                        email: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: { $arrayElemAt: ["$owner", 0] }
                        }
                    }
                ]
            }
        }
    ])

    if (!user?.length) {
        throw new ApiError(404, "User not found");
    }

    return res
        .status(200)
        .json(new ApiResponse(200, user[0]?.watchHistory, "Watch history fetched successfully"));
});



export {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
  getUserChannelProfile,
  getWatchHistory
};
