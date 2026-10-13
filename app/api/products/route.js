
import { prisma } from "../../../src/lib/prisma";
import { verifyAuth } from "../../../src/lib/auth";

function jsonError(message, status) {
  return Response.json(
    { success: false, message },
    { status }
  );
}

async function getActiveUser(request) {
  const auth = verifyAuth(request);

  if (!auth.success) {
    return {
      success: false,
      response: jsonError(auth.message, auth.status),
    };
  }

  const userId = Number(auth.user.id);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return {
      success: false,
      response: jsonError("Invalid user ID", 401),
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    return {
      success: false,
      response: jsonError(
        "User not found or account is inactive",
        403
      ),
    };
  }

  return { success: true, user };
}

async function readJson(request) {
  try {
    const body = await request.json();

    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return { success: false };
    }

    return { success: true, body };
  } catch {
    return { success: false };
  }
}

// GET /api/products
// المستخدم المسجل والنشط يستطيع عرض المنتجات النشطة.
export async function GET(request) {
  try {
    const result = await getActiveUser(request);

    if (!result.success) {
      return result.response;
    }

    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });

    return Response.json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error("GET_PRODUCTS_ERROR:", error);

    return jsonError("Failed to fetch products", 500);
  }
}

// POST /api/products
// الأدمن فقط يستطيع إضافة المنتجات.
export async function POST(request) {
  try {
    const result = await getActiveUser(request);

    if (!result.success) {
      return result.response;
    }

    if (result.user.role !== "ADMIN") {
      return jsonError(
        "Only administrators can create products",
        403
      );
    }

    const parsed = await readJson(request);

    if (!parsed.success) {
      return jsonError("Invalid JSON request body", 400);
    }

    const {
      name,
      sku,
      description,
      price,
      stock,
      image,
    } = parsed.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof sku !== "string" ||
      !sku.trim()
    ) {
      return jsonError(
        "Product name and SKU are required",
        400
      );
    }

    // نقبل السعر كرقم أو كنص رقمي، ونرفض القيم غير الصالحة.
    if (
      price === undefined ||
      price === null ||
      price === "" ||
      typeof price === "boolean" ||
      (typeof price !== "number" && typeof price !== "string")
    ) {
      return jsonError("Price must be a valid number", 400);
    }

    const parsedPrice = Number(price);
    const parsedStock = stock === undefined ? 0 : stock;

    if (
      !Number.isFinite(parsedPrice) ||
      parsedPrice < 0 ||
      parsedPrice > 1000000000
    ) {
      return jsonError(
        "Price must be between 0 and 1000000000",
        400
      );
    }

    if (
      typeof parsedStock !== "number" ||
      !Number.isSafeInteger(parsedStock) ||
      parsedStock < 0
    ) {
      return jsonError(
        "Stock must be a non-negative integer",
        400
      );
    }

    if (
      description !== undefined &&
      description !== null &&
      typeof description !== "string"
    ) {
      return jsonError(
        "Description must be a string",
        400
      );
    }

    if (
      image !== undefined &&
      image !== null &&
      typeof image !== "string"
    ) {
      return jsonError("Image must be a string", 400);
    }

    const cleanName = name.trim();
    const cleanSku = sku.trim();
    const cleanDescription =
      typeof description === "string"
        ? description.trim() || null
        : null;
    const cleanImage =
      typeof image === "string"
        ? image.trim() || null
        : null;

    if (cleanName.length > 200 || cleanSku.length > 100) {
      return jsonError(
        "Product name or SKU is too long",
        400
      );
    }

    if (
      cleanDescription !== null &&
      cleanDescription.length > 5000
    ) {
      return jsonError("Description is too long", 400);
    }

    if (cleanImage !== null && cleanImage.length > 2048) {
      return jsonError("Image URL is too long", 400);
    }

    const product = await prisma.product.create({
      data: {
        name: cleanName,
        sku: cleanSku,
        description: cleanDescription,
        price: parsedPrice,
        stock: parsedStock,
        image: cleanImage,
      },
    });

    return Response.json(
      {
        success: true,
        message: "Product created successfully",
        product,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("CREATE_PRODUCT_ERROR:", error);

    // Prisma: قيمة فريدة موجودة بالفعل.
    if (error?.code === "P2002") {
      return jsonError(
        "A product with this SKU already exists",
        409
      );
    }

    return jsonError("Failed to create product", 500);
  }
}
