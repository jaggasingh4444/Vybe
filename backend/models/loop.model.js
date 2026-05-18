import mongoose from "mongoose"

const loopSchema = new mongoose.Schema({
    author:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"User",
            required:true
        },
        media:{
            type:String,
            required:true
        },
        mediaType:{
            type:String,
            enum:["video"],
            default:"video"
        },
        caption:{
            type:String
        },
        likes:[
            {
            type:mongoose.Schema.Types.ObjectId,
            ref:"User",
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

loopSchema.index({ createdAt: -1 });
loopSchema.index({ author: 1, createdAt: -1 });

const Loop = mongoose.model("Loop",loopSchema)

export default Loop
