"""Contrato do instalador em PostgreSQL isolado, sem rede ou dados reais.

Execução explícita: TRANSCRITOR_TEST_POSTGRES=1 python -m pytest este_arquivo -q.
Usa somente a imagem local pgvector/pgvector:pg17; não baixa dependências.
"""

import os
import subprocess
import time
from pathlib import Path

import pytest

SCHEMA = (Path(__file__).resolve().parents[1] / "supabase" / "schema.sql").read_text()
TABLES = {
    "transcriptions": "(id, file_name) values ('contract', 'teste.mp4')",
    "atas": "(id, title, source_id) values ('contract', 'Ata de teste', 'contract')",
    "jobs": "(id, status, transcription_id) values ('contract', 'queued', 'contract')",
}


@pytest.fixture(scope="module")
def postgres():
    if os.getenv("TRANSCRITOR_TEST_POSTGRES") != "1":
        pytest.skip("Defina TRANSCRITOR_TEST_POSTGRES=1 para usar PostgreSQL descartável")

    container = subprocess.run(
        [
            "docker", "run", "--detach", "--rm", "--pull=never", "--network=none",
            "--tmpfs", "/var/lib/postgresql/data",
            "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "pgvector/pgvector:pg17",
        ],
        capture_output=True, text=True, check=True, timeout=30,
    ).stdout.strip()

    def execute(query, database="postgres", *, check=True):
        return subprocess.run(
            [
                "docker", "exec", "--interactive", container,
                "psql", "-X", "--username=postgres", "--dbname=" + database,
                "--no-align", "--tuples-only", "--quiet", "--set=ON_ERROR_STOP=1",
            ],
            input=query, capture_output=True, text=True, check=check, timeout=10,
        )

    try:
        for _ in range(100):
            ready = subprocess.run(
                ["docker", "exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
                capture_output=True, timeout=10,
            )
            if ready.returncode == 0:
                break
            time.sleep(0.1)
        else:
            pytest.fail("PostgreSQL descartável não ficou pronto")

        execute("""
            create role anon nologin;
            create role authenticated nologin;
            create role service_role nologin bypassrls;
        """)
        yield execute
    finally:
        subprocess.run(
            ["docker", "rm", "--force", container],
            capture_output=True, check=True, timeout=10,
        )


@pytest.mark.parametrize("legacy_defaults", [False, True], ids=["defaults-fechados", "legado"])
def test_schema_permissions_and_crud(postgres, legacy_defaults):
    database = "transcritor_legacy" if legacy_defaults else "transcritor_fresh"
    postgres("create database " + database)

    def execute(query, *, check=True):
        return postgres(query, database, check=check)

    if legacy_defaults:
        execute("""
            alter default privileges in schema public
              grant all on tables to anon, authenticated, service_role;
        """)
    else:
        execute("""
            alter default privileges in schema public
              revoke all on tables from public, anon, authenticated, service_role;
        """)

    execute("""
        create table public.unrelated (id integer primary key);
        insert into public.unrelated values (1);
        grant select on public.unrelated to anon;
    """)
    unrelated_acl = execute("""
        select relacl::text from pg_class where oid = 'public.unrelated'::regclass;
    """).stdout
    defaults = execute("select defaclacl::text from pg_default_acl order by oid").stdout

    execute(SCHEMA)
    if legacy_defaults:
        execute("""
            alter table public.transcriptions disable row level security;
            alter table public.atas disable row level security;
            alter table public.jobs disable row level security;
            grant all on public.transcriptions, public.atas, public.jobs
              to public, anon, authenticated, service_role;
        """)
    execute("insert into public.transcriptions (id, file_name) values ('preserved', 'anterior.mp4')")

    # Reaplicar fecha o modelo legado e preserva os registros e o banco compartilhado.
    execute(SCHEMA)
    assert execute("select count(*) from public.transcriptions where id = 'preserved'").stdout.strip() == "1"
    assert execute("select count(*) from public.unrelated").stdout.strip() == "1"
    assert execute("select relacl::text from pg_class where oid = 'public.unrelated'::regclass").stdout == unrelated_acl
    assert execute("select defaclacl::text from pg_default_acl order by oid").stdout == defaults
    assert execute("""
        select count(*) = 3 and bool_and(relrowsecurity)
        from pg_class
        where oid in ('public.transcriptions'::regclass, 'public.atas'::regclass, 'public.jobs'::regclass);
    """).stdout.strip() == "t"

    # O backend consegue criar, repetir uma gravação (upsert), ler e atualizar.
    for table, values in TABLES.items():
        execute(f"""
            set role service_role;
            insert into public.{table} {values};
            insert into public.{table} {values} on conflict (id) do update set id = excluded.id;
            update public.{table} set metadata = '{{"checked": true}}' where id = 'contract';
        """)
        assert execute(f"""
            set role service_role;
            select metadata->>'checked' from public.{table} where id = 'contract';
        """).stdout.strip() == "true"

    # Cada operação é realmente recusada, inclusive com registro existente.
    for role in ("anon", "authenticated"):
        for table, values in TABLES.items():
            operations = [
                f"select id from public.{table}",
                f"insert into public.{table} {values}",
                f"update public.{table} set id = id where id = 'contract'",
                f"delete from public.{table} where id = 'contract'",
                f"truncate public.{table}",
            ]
            for query in operations:
                result = execute(f"set role {role}; {query};", check=False)
                assert result.returncode != 0, (role, query)
                assert "permission denied for table" in result.stderr, (role, query, result.stderr)

    for table in TABLES:
        assert execute(f"""
            select not has_table_privilege('service_role', 'public.{table}', 'TRUNCATE')
               and not has_table_privilege('service_role', 'public.{table}', 'REFERENCES')
               and not has_table_privilege('service_role', 'public.{table}', 'TRIGGER');
        """).stdout.strip() == "t"

    for table in reversed(TABLES):
        execute(f"set role service_role; delete from public.{table} where id = 'contract';")
        assert execute(f"select count(*) from public.{table} where id = 'contract'").stdout.strip() == "0"
