
import jwt from "jsonwebtoken";

export function verifyAuth(request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      success: false,
      status: 401,
      message: "Authentication token is required",
    };
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.userId || !decoded.role) {
      return {
        success: false,
        status: 401,
        message: "Invalid authentication token",
      };
    }

    return {
      success: true,
      user: {
        id: decoded.userId,
        role: decoded.role,
      },
    };
  } catch (error) {
    return {
      success: false,
      status: 401,
      message: "Invalid or expired authentication token",
    };
  }
}
