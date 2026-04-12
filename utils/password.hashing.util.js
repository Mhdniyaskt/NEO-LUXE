import bcrypt from "bcrypt"


export const hashpassword=async(password)=>{
    return await bcrypt.hash(password,10)

}

export const comparePassword=async(password,hashpassword)=>{
    return await bcrypt.compare(password,hashpassword)
}