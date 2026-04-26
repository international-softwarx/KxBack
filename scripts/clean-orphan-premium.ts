/**
 * Script para limpiar usuarios con premiumExpiry huérfano
 * (isPremium=false pero premiumExpiry tiene fecha)
 */

import 'dotenv/config';
import mongoose from 'mongoose';

async function main() {
  console.log('\n🧹 Limpieza de premiumExpiry huérfano...\n');
  
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('✅ MongoDB conectado\n');

  const UserModel = (await import('../src/infrastructure/database/models/UserModel')).UserModel;

  // Buscar usuarios con isPremium=false pero con premiumExpiry
  const usersWithOrphanExpiry = await UserModel.find({
    isPremium: false,
    premiumExpiry: { $exists: true },
  });

  if (usersWithOrphanExpiry.length === 0) {
    console.log('✅ No hay usuarios con premiumExpiry huérfano');
  } else {
    console.log(`🔍 Encontrados ${usersWithOrphanExpiry.length} usuarios con premiumExpiry huérfano:\n`);
    
    for (const user of usersWithOrphanExpiry) {
      console.log(`   - ${user.username} (${user.email}) - Premium Expiry: ${user.premiumExpiry}`);
    }

    console.log('\n🧹 Limpiando...\n');

    const result = await UserModel.updateMany(
      { isPremium: false, premiumExpiry: { $exists: true } },
      { $unset: { premiumExpiry: 1 } }
    );

    console.log(`✅ Limpiados ${result.modifiedCount} usuarios`);

    // Verificar
    const remaining = await UserModel.countDocuments({
      isPremium: false,
      premiumExpiry: { $exists: true },
    });

    if (remaining === 0) {
      console.log('✅ Todos los premiumExpiry huérfanos fueron eliminados');
    } else {
      console.log(`⚠️ Quedan ${remaining} usuarios con premiumExpiry huérfano`);
    }
  }

  await mongoose.disconnect();
  console.log('\n👋 MongoDB desconectado\n');
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
