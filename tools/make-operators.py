#!/usr/bin/env python3
"""
Bulk-create handheld operator logins for TriloWMS.

Usage:  python3 tools/make-operators.py operators.csv
Input CSV columns: employee_id,name,role,shift,warehouse   (role e.g. picker, forklift_operator, packing_operator)
Output (next to the CSV):
  operators-create.sql   -> paste into Supabase > SQL Editor > Run (safe to re-run; existing ids are skipped)
  operators-logins.csv   -> employee_id, name, role, password  (hand out; keep OUT of git)
Operators sign in with their employee ID (e.g. E1001) and the generated password.
"""
import csv, secrets, string, sys, pathlib

ROLES = {"picker","forklift_operator","packing_operator","inbound_supervisor","outbound_supervisor",
         "yard_manager","qc_inspector","inventory_manager","operations_manager","auditor"}
ALPHA = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no look-alike characters
q = lambda s: "'" + str(s).replace("'", "''") + "'"

def main(path):
    src = pathlib.Path(path); rows = []
    for i, r in enumerate(csv.DictReader(src.open(encoding="utf-8-sig")), start=2):
        eid = r["employee_id"].strip().lower()
        role = r["role"].strip()
        if not eid or "@" in eid or " " in eid: sys.exit(f"line {i}: bad employee_id '{eid}'")
        if role not in ROLES: sys.exit(f"line {i}: unknown role '{role}' (allowed: {', '.join(sorted(ROLES))})")
        pw = "".join(secrets.choice(ALPHA) for _ in range(8))
        rows.append((eid, r["name"].strip(), role, (r.get("shift") or "Shift A").strip(), (r.get("warehouse") or "TRILO-DC-01").strip(), pw))
    vals = ",\n".join(f"  ({q(e+'@trilowms.com')}, {q(pw)}, {q(n)}, {q(role)}, {q(sh)}, {q(wh)}, {q(e.upper())})" for e, n, role, sh, wh, pw in rows)
    sql = f"""-- TriloWMS: bulk operator logins ({len(rows)} accounts). Run once in Supabase > SQL Editor. Re-running skips existing ids.
with wanted(email, pw, full_name, app_role, shift, warehouse, emp_id) as (values
{vals}
), ins as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
         w.email, crypt(w.pw, gen_salt('bf')), now(),
         jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'wms_role',w.app_role),
         jsonb_build_object('full_name', w.full_name, 'shift', w.shift, 'warehouse', w.warehouse, 'employee_id', w.emp_id),
         now(), now(), '', '', '', ''
  from wanted w
  where not exists (select 1 from auth.users u where lower(u.email) = lower(w.email))
  returning id, email
)
insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), i.id, jsonb_build_object('sub', i.id::text, 'email', i.email, 'email_verified', true),
       'email', i.id::text, now(), now(), now()
from ins i;

select count(*) as operator_accounts from auth.users where raw_app_meta_data ? 'wms_role';
"""
    (src.parent / "operators-create.sql").write_text(sql)
    with (src.parent / "operators-logins.csv").open("w", newline="") as f:
        w = csv.writer(f); w.writerow(["employee_id", "name", "role", "password"])
        for e, n, role, sh, wh, pw in rows: w.writerow([e.upper(), n, role, pw])
    print(f"{len(rows)} accounts -> operators-create.sql, operators-logins.csv")

if __name__ == "__main__":
    main(sys.argv[1]) if len(sys.argv) == 2 else sys.exit(__doc__)
