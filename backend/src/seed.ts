// Bootstraps the first admin account (and, for local testing, one student
// account) from env vars — never hardcoded. Real student accounts will come
// from LDAP sync later; this seed only exists to have someone to log in as
// while that's not wired up yet.
// Run with: npm run seed
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "./db/prisma";

async function seedUser(login: string, password: string, fullName: string, role: "ADMIN" | "STUDENT") {
  const existing = await prisma.user.findUnique({ where: { login } });
  if (existing) {
    console.log(`${role} ${login} already exists, skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { login, passwordHash, fullName, role },
  });
  console.log(`Created ${role.toLowerCase()} ${user.login}`);
}

async function main() {
  const adminLogin = process.env.SEED_ADMIN_LOGIN;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminName = process.env.SEED_ADMIN_NAME ?? "Admin";

  if (!adminLogin || !adminPassword) {
    throw new Error("SEED_ADMIN_LOGIN and SEED_ADMIN_PASSWORD must be set in the environment.");
  }

  await seedUser(adminLogin, adminPassword, adminName, "ADMIN");

  const studentLogin = process.env.SEED_STUDENT_LOGIN;
  const studentPassword = process.env.SEED_STUDENT_PASSWORD;
  const studentName = process.env.SEED_STUDENT_NAME ?? "Test Student";

  if (studentLogin && studentPassword) {
    await seedUser(studentLogin, studentPassword, studentName, "STUDENT");
  } else {
    console.log("SEED_STUDENT_LOGIN/SEED_STUDENT_PASSWORD not set, skipping student seed.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
