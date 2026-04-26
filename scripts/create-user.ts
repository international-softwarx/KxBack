/**
 * Script para crear usuarios con configuración personalizada de trial y premium
 * Uso: 
 *   npm run create-user -- --email test@test.com --password 12345678 --username testuser
 *   npm run create-user -- --email premium@test.com --password 12345678 --username premiumuser --trial-days 0 --premium-days 30
 *   npm run create-user -- --email free@test.com --password 12345678 --username freeuser --trial-days 0 --premium-days 0
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { MongoUserRepository } from '../src/infrastructure/database/repositories/MongoUserRepository';
import { BcryptHashService } from '../src/infrastructure/auth/services';

interface Args {
  email: string;
  password: string;
  username: string;
  trialDays: number;
  premiumDays: number;
  isActive: boolean;
  emailVerified: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace('--', '');
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        parsed[key] = value;
        i++;
      }
    }
  }

  return {
    email: parsed.email || '',
    password: parsed.password || '',
    username: parsed.username || '',
    trialDays: Number(parsed['trial-days'] ?? 7),
    premiumDays: Number(parsed['premium-days'] ?? 0),
    isActive: parsed['is-active'] !== 'false',
    emailVerified: parsed['email-verified'] === 'true',
  };
}

async function main() {
  const args = parseArgs();

  if (!args.email || !args.password || !args.username) {
    console.error(`
❌ Faltan argumentos requeridos

Uso:
  npm run create-user -- --email <email> --password <password> --username <username> [opciones]

Opciones:
  --trial-days <número>      Días de trial (default: 7, usar 0 para sin trial)
  --premium-days <número>    Días de premium (default: 0)
  --is-active <true|false>   Usuario activo (default: true)
  --email-verified <true|false> Email verificado (default: false)

Ejemplos:
  # Usuario con 7 días de trial (default)
  npm run create-user -- --email user@test.com --password 12345678 --username user1

  # Usuario SIN trial (trial expirado inmediatamente)
  npm run create-user -- --email free@test.com --password 12345678 --username freeuser --trial-days 0

  # Usuario con premium de 30 días
  npm run create-user -- --email premium@test.com --password 12345678 --username premiumuser --trial-days 0 --premium-days 30

  # Usuario con premium de 365 días (anual)
  npm run create-user -- --email annual@test.com --password 12345678 --username annualuser --trial-days 0 --premium-days 365
`);
    process.exit(1);
  }

  if (args.password.length < 8) {
    console.error('❌ La contraseña debe tener al menos 8 caracteres');
    process.exit(1);
  }

  console.log('\n🔧 Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('✅ MongoDB conectado');

  try {
    const users = new MongoUserRepository();
    const hash = new BcryptHashService(12);

    // Verificar si el usuario ya existe
    const existing = await users.findByEmail(args.email.toLowerCase());
    if (existing) {
      console.error(`\n❌ Ya existe un usuario con ese email: ${args.email}`);
      process.exit(1);
    }

    // Crear usuario
    const passwordHash = await hash.hash(args.password);
    
    const trialStartedAt = args.trialDays > 0 ? new Date() : undefined;
    const premiumExpiry = args.premiumDays > 0 
      ? new Date(Date.now() + args.premiumDays * 24 * 60 * 60 * 1000) 
      : undefined;

    const user = await users.create({
      username: args.username,
      email: args.email.toLowerCase(),
      passwordHash,
      isPremium: args.premiumDays > 0,
      premiumExpiry,
      trialDaysLeft: args.trialDays,
      trialDurationDays: args.trialDays,
      trialStartedAt,
      activeSessions: [],
      emailVerified: args.emailVerified,
      isActive: args.isActive,
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

    // Mostrar estado del usuario
    console.log('\n📊 Estado del usuario:');
    if (args.premiumDays > 0) {
      console.log(`   ✨ PREMIUM ACTIVO (${args.premiumDays} días)`);
    } else if (args.trialDays > 0) {
      console.log(`   ⏰ EN TRIAL (${args.trialDays} días restantes)`);
    } else {
      console.log(`   🔒 TRIAL EXPIRADO - Usuario FREE (funciones básicas solamente)`);
    }

    console.log('\n💡 Para probar login:');
    console.log(`   curl -X POST http://localhost:4000/api/auth/login \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"email":"${args.email}","password":"${args.password}","machineId":"test"}'`);

  } catch (error) {
    console.error('\n❌ Error al crear usuario:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 MongoDB desconectado');
  }
}

main();
