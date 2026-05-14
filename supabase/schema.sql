-- AURION Tools — Schema de Supabase
-- Ejecutar este archivo en el SQL Editor de Supabase

-- =============================================================================
-- Tabla: profiles (extiende auth.users)
-- =============================================================================
create table if not exists public.profiles (
    id              uuid references auth.users(id) on delete cascade primary key,
    email           text not null unique,
    full_name       text,
    company_name    text,
    plan            text not null default 'FLEX', -- FLEX | PRIME
    is_admin        boolean not null default false,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- =============================================================================
-- Tabla: operations
-- =============================================================================
create table if not exists public.operations (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references public.profiles(id) on delete cascade,
    operation_type  text not null,
    -- 'photo_extract' | 'pdf_to_word' | 'pdf_to_excel' | 'word_to_pdf' | 'excel_to_pdf'
    status          text not null default 'pending',
    -- 'pending' | 'processing' | 'completed' | 'failed'
    input_file      text,
    input_filename  text,
    output_file     text,
    output_filename text,
    metadata        jsonb,
    error_message   text,
    cost_estimate   numeric(10,4) default 0,
    started_at      timestamptz not null default now(),
    completed_at    timestamptz,
    created_at      timestamptz not null default now()
);

create index if not exists idx_operations_user on public.operations(user_id, created_at desc);
create index if not exists idx_operations_status on public.operations(status);

-- =============================================================================
-- Trigger: auto-crear perfil cuando se registra un usuario
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
    insert into public.profiles (id, email, full_name)
    values (new.id, new.email, new.raw_user_meta_data->>'full_name')
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- =============================================================================
-- Función: contar operaciones recientes (rolling 30 días)
-- =============================================================================
create or replace function public.count_recent_operations(p_user_id uuid)
returns integer
language sql
stable
as $$
    select count(*)::integer
    from public.operations
    where user_id = p_user_id
      and status = 'completed'
      and created_at >= (now() - interval '30 days');
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.operations enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
    on public.profiles for select
    using (auth.uid() = id or exists(
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_admin = true
    ));

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
    on public.profiles for update
    using (auth.uid() = id);

drop policy if exists "Users see own operations" on public.operations;
create policy "Users see own operations"
    on public.operations for select
    using (auth.uid() = user_id or exists(
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_admin = true
    ));

drop policy if exists "Users insert own operations" on public.operations;
create policy "Users insert own operations"
    on public.operations for insert
    with check (auth.uid() = user_id);

drop policy if exists "Users update own operations" on public.operations;
create policy "Users update own operations"
    on public.operations for update
    using (auth.uid() = user_id or exists(
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_admin = true
    ));

-- =============================================================================
-- Storage policies para bucket "files"
-- =============================================================================
-- Permitir a usuarios autenticados subir archivos en su propia carpeta (/{user_id}/...)
insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict (id) do nothing;

drop policy if exists "Users upload to own folder" on storage.objects;
create policy "Users upload to own folder"
    on storage.objects for insert
    with check (
        bucket_id = 'files'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "Users read own files" on storage.objects;
create policy "Users read own files"
    on storage.objects for select
    using (
        bucket_id = 'files'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "Users delete own files" on storage.objects;
create policy "Users delete own files"
    on storage.objects for delete
    using (
        bucket_id = 'files'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
