import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
dotenv.config()

// Create transporter
const transporter = nodemailer.createTransport({
  service: "Gmail",
  port: 465,
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASS,
  },
});

// Fixed: Changed sendMain to sendMail
const sendMail = async (to, otp, options = {}) => {
  const subject = options.subject || "Reset Your Password";
  const intro = options.intro || "Your OTP for password reset is";
  const expiresIn = options.expiresIn || "5 minutes";

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL,
      to,
      subject,
      html: `<p>${intro} <b>${otp}</b>. It expires in ${expiresIn}.</p>`
    });
    
    console.log('✅ Email sent successfully:', info.messageId);
    return { success: true, info };
  } catch (error) {
    console.error('❌ Error sending email:', error);
    return { success: false, error };
  }
};

// Now this matches the function name above
export default sendMail;
