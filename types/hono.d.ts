import type { SupabaseClient } from "@supabase/supabase-js";

declare module "hono" {
  interface ContextVariableMap {
    supabase: SupabaseClient;
  }
}
