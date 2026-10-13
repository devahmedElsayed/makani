import "dotenv/config";
import { PrismaClient } from "../src/generated/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  const hashedPassword = await bcrypt.hash("123456", 10);

  const user = await prisma.user.upsert({
    where: {
      email: "admin@makani.com",
    },
    update: {},
    create: {
      name: "Admin",
      email: "admin@makani.com",
      password: hashedPassword,
      phone: "0500000000",
      role: "ADMIN",
    },
  });

  console.log("User created:", user.email);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });