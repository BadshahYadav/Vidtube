import {v2 as cloudinary} from "cloudinary"
import fs from "fs"
import path from "path"
import dotenv from "dotenv";

// Load environment variables from .env file
// Ensure this is at the top of your file to load variables before using them
dotenv.config();


cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadOnCloudinary = async (localFilePath) => {
    try {
        if (!localFilePath) return null
        
        // Convert to absolute path to handle Windows paths properly
        const absolutePath = path.resolve(localFilePath);
        console.log("Attempting to upload file:", absolutePath);
        console.log("File exists:", fs.existsSync(absolutePath));
        console.log("Cloudinary config:", {
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET ? "***set***" : "***not set***"
        });
        
        //upload the file on cloudinary
        const response = await cloudinary.uploader.upload(absolutePath, {
            resource_type: "auto"
        })
        
        console.log("Cloudinary upload successful:", response.url);
        
        // file has been uploaded successfull
        fs.unlinkSync(absolutePath)
        return response;

    } catch (error) {
        console.error("Cloudinary upload error:", error);
        // Try to remove the file even if upload failed
        try {
            const absolutePath = path.resolve(localFilePath);
            fs.unlinkSync(absolutePath)
        } catch (unlinkError) {
            console.error("Error removing temp file:", unlinkError);
        }
        return null;
    }
}



export {uploadOnCloudinary}