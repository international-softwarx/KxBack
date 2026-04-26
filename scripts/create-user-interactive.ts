/**
 * Script interactivo para crear usuarios con configuración personalizada
 * Uso: npm run create-user
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import * as readline from 'readline';
import { MongoUserRepository } from '../src/infrastructure/database/repositories/MongoUserRepository';
import { BcryptHashService } from '../src/infrastructure/auth/services';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n🔧 ========================================');
  console.log('   CREAR USUARIO - KX BACKEND');
  console.log('========================================\n');

  const email = await ask('📧 Email: ');
  if (!email || !email.includes('@')) {
    console.error('❌ Email inválido');
    process.exit(1);
  }

  const username = await ask('👤 Username: ');
  if (!username || username.length < 3) {
    console.error('❌ Username debe tener al menos 3 caracteres');
    process.exit(1);
  }

  const password = await ask('🔒 Password (min 8 caracteres): ');
  if (password.length < 8) {
    console.error('❌ Password debe tener al menos 8 caracteres');
    process.exit(1);
  }

  const trialDaysStr = await ask('⏰ Días de trial (default: 0): ');
  const trialDays = trialDaysStr ? parseInt(trialDaysStr) : 0;

  const premiumDaysStr = await ask('👑 Días de premium (default: 0): ');
  const premiumDays = premiumDaysStr ? parseInt(premiumDaysStr) : 0;

  const isActiveStr = await ask('✅ Usuario activo? (Y/n, default: Y): ');
  const isActive = isActiveStr.toLowerCase() !== 'n';

  const emailVerifiedStr = await ask('📧 Email verificado? (y/N, default: N): ');
  const emailVerified = emailVerifiedStr.toLowerCase() === 'y';

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Resumen del usuario a crear:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Email:           ${email}`);
  console.log(`   Username:        ${username}`);
  console.log(`   Password:        ${'*'.repeat(password.length)}`);
  console.log(`   Trial Days:      ${trialDays}`);
  console.log(`   Premium Days:    ${premiumDays}`);
  console.log(`   Activo:          ${isActive ? 'Sí' : 'No'}`);
  console.log(`   Email Verificado: ${emailVerified ? 'Sí' : 'No'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const confirm = await ask('¿Crear este usuario? (y/N): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('❌ Cancelado');
    rl.close();
    process.exit(0);
  }

  console.log('\n🔧 Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('✅ MongoDB conectado\n');

  try {
    const users = new MongoUserRepository();
    const hash = new BcryptHashService(12);

    const existing = await users.findByEmail(email.toLowerCase());
    if (existing) {
      console.error(`\n❌ Ya existe un usuario con ese email: ${email}`);
      process.exit(1);
    }

    const passwordHash = await hash.hash(password);
    
    const trialStartedAt = trialDays > 0 ? new Date() : undefined;
    const premiumExpiry = premiumDays > 0 
      ? new Date(Date.now() + premiumDays * 24 * 60 * 60 * 1000) 
      : undefined;

    const user = await users.create({
      username,
      email: email.toLowerCase(),
      passwordHash,
      isPremium: premiumDays > 0,
      premiumExpiry,
      trialDaysLeft: trialDays,
      trialDurationDays: trialDays,
      trialStartedAt,
      activeSessions: [],
      emailVerified,
      isActive,
    });

    console.log('\n✅ Usuario creado exitosamente!\n');
    console.log('📋 Datos del usuario:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  ID:              ${user.id}`);
    console.log(`  Username:        ${user.username}`);
    console.log(`  Email:           ${user.email}`);
    console.log(`  Trial Days:      ${user.trialDaysLeft}`);
    console.log(`  Premium:         ${user.isPremium ? 'Sí' : 'No'}`);
    if (user.premiumExpiry) {
      console.log(`  Premium Expiry:  ${user.premiumExpiry.toISOString()}`);
    }
    console.log(`  Email Verified:  ${user.emailVerified ? 'Sí' : 'No'}`);
    console.log(`  Is Active:       ${user.isActive ? 'Sí' : 'No'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    console.log('\n📊 Estado del usuario:');
    if (premiumDays > 0) {
      console.log(`   ✨ PREMIUM ACTIVO (${premiumDays} días)`);
    } else if (trialDays > 0) {
      console.log(`   ⏰ EN TRIAL (${trialDays} días restantes)`);
    } else {
      console.log(`   🔒 TRIAL EXPIRADO - Usuario FREE (funciones básicas solamente)`);
    }

    console.log('\n💡 Para probar login:');
    console.log(`   curl -X POST http://localhost:4000/api/auth/login ^`);
    console.log(`     -H "Content-Type: application/json" ^`);
    console.log(`     -d "{\"email\":\"${email}\",\"password\":\"${password}\",\"machineId\":\"test\"}"`);

  } catch (error) {
    console.error('\n❌ Error al crear usuario:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 MongoDB desconectado');
    rl.close();
  }
}

main();
