import jwt from "jsonwebtoken"

const genToken = async (userId) =>{
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "10y" })
}

export default genToken
