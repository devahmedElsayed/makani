
import bcrypt from "bcryptjs";
import { prisma } from "../../../src/lib/prisma";
import { verifyAuth } from "../../../src/lib/auth";

function errorResponse(message, status) {
  return Response.json(
    { success: false, message },
    { status }
  );
}

async function getAuthenticatedUser(request) {
  const auth = verifyAuth(request);

  if (!auth.success) {
    return {
      success: false,
      response: errorResponse(auth.message, auth.status),
    };
  }

  const id = Number(auth.user.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return {
      success: false,
      response: errorResponse("Invalid user ID", 401),
    };
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    return {
      success: false,
      response: errorResponse(
        "User not found or account is inactive",
        403
      ),
    };
  }

  return { success: true, user };
}

// GET /api/users
// الأدمن يرى المستخدمين، والمندوب يرى بياناته فقط.
export async function GET(request) {
  try {
    const result = await getAuthenticatedUser(request);

    if (!result.success) {
      return result.response;
    }

    const where =
      result.user.role === "ADMIN"
        ? {}
        : { id: result.user.id };

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    console.error("GET_USERS_ERROR:", error);
    return errorResponse("Failed to fetch users", 500);
  }
}

// POST /api/users
// الأدمن فقط يستطيع إنشاء حسابات.
export async function POST(request) {
  try {
    const result = await getAuthenticatedUser(request);

    if (!result.success) {
      return result.response;
    }

    if (result.user.role !== "ADMIN") {
      return errorResponse(
        "Only administrators can create users",
        403
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON request body", 400);
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return errorResponse("Request body must be an object", 400);
    }

    const { name, email, password, phone, role } = body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      password.length < 8
    ) {
      return errorResponse(
        "Name, valid email and password of at least 8 characters are required",
        400
      );
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length > 150 || cleanEmail.length > 254) {
      return errorResponse("Name or email is too long", 400);
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(cleanEmail)) {
      return errorResponse("Invalid email address", 400);
    }

    if (password.length > 72) {
      return errorResponse(
        "Password must not exceed 72 characters",
        400
      );
    }

    if (
      phone !== undefined &&
      phone !== null &&
      typeof phone !== "string"
    ) {
      return errorResponse("Phone must be a string", 400);
    }

    if (typeof phone === "string" && phone.trim().length > 30) {
      return errorResponse("Phone number is too long", 400);
    }

    // لا نسمح بإنشاء أدمن إضافي من هذا المسار.
    // هذا المسار مخصص لحسابات المناديب فقط.
    if (role !== undefined && role !== "SALES_REP") {
      return errorResponse(
        "Only SALES_REP accounts can be created through this endpoint",
        400
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: cleanName,
        email: cleanEmail,
        password: passwordHash,
        phone:
          typeof phone === "string"
            ? phone.trim() || null
            : null,
        role: "SALES_REP",
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return Response.json(
      {
        success: true,
        message: "Sales representative created successfully",
        user,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("CREATE_USER_ERROR:", error);

    if (error?.code === "P2002") {
      return errorResponse(
        "A user with this email already exists",
        409
      );
    }

    return errorResponse("Failed to create user", 500);
  }
}
