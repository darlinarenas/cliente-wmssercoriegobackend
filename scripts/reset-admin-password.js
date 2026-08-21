import 'dotenv/config';
import { hashPassword } from '../src/security/passwords.js';
import pg from 'pg';

const { Pool } = pg;

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const databaseSsl = ['1','true','yes','si'].includes(String(process.env.DATABASE_SSL || '').toLowerCase());
const username = String(process.env.RESET_ADMIN_USERNAME || 'admin').trim().toLowerCase();
const password = String(process.env.RESET_ADMIN_PASSWORD || '');

if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL no está configurada.');
  process.exit(1);
}
if (!username) {
  console.error('ERROR: RESET_ADMIN_USERNAME no puede estar vacío.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('ERROR: RESET_ADMIN_PASSWORD debe tener al menos 8 caracteres.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseSsl ? { rejectUnauthorized: false } : false,
});

try {
  const found = await pool.query(
    'SELECT id, name, username, role, active FROM users WHERE lower(username)=$1 LIMIT 1',
    [username]
  );

  if (!found.rows.length) {
    console.error(`ERROR: No existe el usuario "${username}". No se modificó nada.`);
    process.exitCode = 2;
  } else {
    const user = found.rows[0];
    if (user.role !== 'ADMINISTRADOR') {
      console.error(`ERROR: El usuario "${username}" existe pero su rol es ${user.role}. No se modificó nada.`);
      process.exitCode = 3;
    } else {
      const hash = await hashPassword(password);
      await pool.query(
        `UPDATE users
         SET password_hash=$1,
             active=true,
             must_change_password=false,
             updated_at=now()
         WHERE id=$2`,
        [hash, user.id]
      );
      console.log('OK: contraseña administrativa actualizada correctamente.');
      console.log(`Usuario: ${user.username}`);
      console.log('No se modificó inventario, productos, racks, órdenes ni ningún otro usuario.');
    }
  }
} catch (error) {
  console.error('ERROR al restablecer la contraseña:', error?.message || error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
