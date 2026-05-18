import mongoose from "mongoose"

const postSchema = new mongoose.Schema({
    author:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        required:true
    },
    mediaType:{
        type:String,
        enum: ["image","video"],
        required:true
    },
    media:{
        type:String,
        required:true
    },
    caption:{
        type:String
    },
    likes:[
        {
        type:mongoose.Schema.Types.ObjectId,
        ref:"User"
        }
    ],
    comments:[
        {
        author:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"User",
            required:true
        },
        text:{
            type:String,
            required:true,
            trim:true,
            maxlength:500
        },
        createdAt:{
            type:Date,
            default:Date.now
        },
        replies:[
            {
            author:{
                type:mongoose.Schema.Types.ObjectId,
                ref:"User",
                required:true
            },
            text:{
                type:String,
                required:true,
                trim:true,
                maxlength:500
            },
            createdAt:{
                type:Date,
                default:Date.now
            }
            }
        ]
        }
    ]
},{timestamps:true})

postSchema.index({ createdAt: -1 });
postSchema.index({ author: 1, createdAt: -1 });

const Post = mongoose.model("Post", postSchema)

export default Post
