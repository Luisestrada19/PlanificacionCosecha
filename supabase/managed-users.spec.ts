import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20261120224500_managed_users.sql');
const migration = readFileSync(migrationPath, 'utf8');

describe('managed user database migration', () => {
  it('creates the two supported roles', () => {
    expect(migration).toContain("'admin'");
    expect(migration).toContain("'supervisor'");
  });

  it('creates the temporary administrator account', () => {
    expect(migration).toContain('admin@agbsmart.com');
    expect(migration).not.toMatch(/insert into\s+auth\.users/i);
    expect(migration).not.toMatch(/insert into\s+auth\.identities/i);
  });

  it('requires the admin role for GeoJSON registration', () => {
    expect(migration).toContain('public.is_team_admin()');
    expect(migration).toContain('Solo el administrador puede agregar o versionar GeoJSON');
  });

  it('does not depend on GitHub OAuth', () => {
    expect(migration).not.toMatch(/github/i);
  });

  it('uses cascading profile deletion', () => {
    expect(migration).toContain('on delete cascade');
    expect(migration).toContain('app_profiles_id_fkey');
  });
});
