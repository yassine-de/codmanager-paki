export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      agent_products: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          product_name: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          product_name: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          product_name?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          is_active: boolean
          message: string
          start_date: string | null
          title: string
          urgency: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          message: string
          start_date?: string | null
          title: string
          urgency?: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          message?: string
          start_date?: string | null
          title?: string
          urgency?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      calls: {
        Row: {
          agent_id: string
          call_end_time: string | null
          call_start_time: string
          created_at: string
          duration: number | null
          id: string
          order_id: string
        }
        Insert: {
          agent_id: string
          call_end_time?: string | null
          call_start_time?: string
          created_at?: string
          duration?: number | null
          id?: string
          order_id: string
        }
        Update: {
          agent_id?: string
          call_end_time?: string | null
          call_start_time?: string
          created_at?: string
          duration?: number | null
          id?: string
          order_id?: string
        }
        Relationships: []
      }
      integration_errors: {
        Row: {
          created_at: string
          error_message: string
          id: string
          order_data: Json | null
          sheet_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string
          id?: string
          order_data?: Json | null
          sheet_id: string
        }
        Update: {
          created_at?: string
          error_message?: string
          id?: string
          order_data?: Json | null
          sheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_errors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "integration_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sheets: {
        Row: {
          active: boolean
          created_at: string
          errors_count: number
          id: string
          last_check: string | null
          last_imported_row: number
          name: string
          orders_count: number
          seller_id: string
          sheet_name: string
          sheet_url: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          errors_count?: number
          id?: string
          last_check?: string | null
          last_imported_row?: number
          name: string
          orders_count?: number
          seller_id: string
          sheet_name?: string
          sheet_url?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          errors_count?: number
          id?: string
          last_check?: string | null
          last_imported_row?: number
          name?: string
          orders_count?: number
          seller_id?: string
          sheet_name?: string
          sheet_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoice_addons: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          invoice_id: string
          reason: string
          type: string
        }
        Insert: {
          amount?: number
          created_at?: string | null
          id?: string
          invoice_id: string
          reason?: string
          type?: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          invoice_id?: string
          reason?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_addons_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_history: {
        Row: {
          changed_by: string | null
          created_at: string
          event_type: string
          field_changed: string | null
          id: string
          invoice_id: string
          new_value: string | null
          old_value: string | null
          order_id: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          event_type?: string
          field_changed?: string | null
          id?: string
          invoice_id: string
          new_value?: string | null
          old_value?: string | null
          order_id?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          event_type?: string
          field_changed?: string | null
          id?: string
          invoice_id?: string
          new_value?: string | null
          old_value?: string | null
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_history_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string | null
          finalized_at: string | null
          id: string
          invoice_number: string
          paid_at: string | null
          paid_by: string | null
          payment_proof_url: string | null
          seller_id: string
          status: string
        }
        Insert: {
          created_at?: string | null
          finalized_at?: string | null
          id?: string
          invoice_number?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_proof_url?: string | null
          seller_id: string
          status?: string
        }
        Update: {
          created_at?: string | null
          finalized_at?: string | null
          id?: string
          invoice_number?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_proof_url?: string | null
          seller_id?: string
          status?: string
        }
        Relationships: []
      }
      order_history: {
        Row: {
          changed_by: string
          changed_by_role: string
          created_at: string
          field_changed: string
          id: string
          new_value: string | null
          old_value: string | null
          order_id: string
        }
        Insert: {
          changed_by: string
          changed_by_role: string
          created_at?: string
          field_changed: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          order_id: string
        }
        Update: {
          changed_by?: string
          changed_by_role?: string
          created_at?: string
          field_changed?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          order_id?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          agent_id: string | null
          assigned_at: string | null
          attempt_count: number
          cancel_reason: string | null
          confirmation_status: string
          confirmed_at: string | null
          created_at: string
          customer_address: string | null
          customer_city: string
          customer_name: string
          customer_phone: string
          delivered_at: string | null
          delivery_status: string | null
          fragile: boolean | null
          id: string
          invoice_id: string | null
          last_activity_at: string | null
          last_price: number | null
          note: string | null
          offers: string | null
          order_id: string
          original_agent_id: string | null
          postpone_date: string | null
          postpone_note: string | null
          price: number
          product_name: string
          product_url: string | null
          quantity: number
          seller_id: string
          shipping_cost: number | null
          shipping_status: string | null
          source_sheet_id: string | null
          store_url: string | null
          total_amount: number
          updated_at: string
          video_url: string | null
          weight: number | null
        }
        Insert: {
          agent_id?: string | null
          assigned_at?: string | null
          attempt_count?: number
          cancel_reason?: string | null
          confirmation_status?: string
          confirmed_at?: string | null
          created_at?: string
          customer_address?: string | null
          customer_city?: string
          customer_name?: string
          customer_phone?: string
          delivered_at?: string | null
          delivery_status?: string | null
          fragile?: boolean | null
          id?: string
          invoice_id?: string | null
          last_activity_at?: string | null
          last_price?: number | null
          note?: string | null
          offers?: string | null
          order_id: string
          original_agent_id?: string | null
          postpone_date?: string | null
          postpone_note?: string | null
          price?: number
          product_name?: string
          product_url?: string | null
          quantity?: number
          seller_id: string
          shipping_cost?: number | null
          shipping_status?: string | null
          source_sheet_id?: string | null
          store_url?: string | null
          total_amount?: number
          updated_at?: string
          video_url?: string | null
          weight?: number | null
        }
        Update: {
          agent_id?: string | null
          assigned_at?: string | null
          attempt_count?: number
          cancel_reason?: string | null
          confirmation_status?: string
          confirmed_at?: string | null
          created_at?: string
          customer_address?: string | null
          customer_city?: string
          customer_name?: string
          customer_phone?: string
          delivered_at?: string | null
          delivery_status?: string | null
          fragile?: boolean | null
          id?: string
          invoice_id?: string | null
          last_activity_at?: string | null
          last_price?: number | null
          note?: string | null
          offers?: string | null
          order_id?: string
          original_agent_id?: string | null
          postpone_date?: string | null
          postpone_note?: string | null
          price?: number
          product_name?: string
          product_url?: string | null
          quantity?: number
          seller_id?: string
          shipping_cost?: number | null
          shipping_status?: string | null
          source_sheet_id?: string | null
          store_url?: string | null
          total_amount?: number
          updated_at?: string
          video_url?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          description: string | null
          id: string
          key: string
          label: string
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          label: string
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          label?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          created_at: string
          display_id: string | null
          id: string
          image_url: string | null
          landed_price: number | null
          last_price: number | null
          name: string
          offers: Json | null
          price: number
          product_url: string | null
          quantity: number
          seller_id: string
          seller_seen: boolean | null
          sku: string
          sourcing_request_id: string | null
          updated_at: string
          variants: Json | null
          video_url: string | null
          weight: string | null
        }
        Insert: {
          created_at?: string
          display_id?: string | null
          id?: string
          image_url?: string | null
          landed_price?: number | null
          last_price?: number | null
          name: string
          offers?: Json | null
          price?: number
          product_url?: string | null
          quantity?: number
          seller_id: string
          seller_seen?: boolean | null
          sku: string
          sourcing_request_id?: string | null
          updated_at?: string
          variants?: Json | null
          video_url?: string | null
          weight?: string | null
        }
        Update: {
          created_at?: string
          display_id?: string | null
          id?: string
          image_url?: string | null
          landed_price?: number | null
          last_price?: number | null
          name?: string
          offers?: Json | null
          price?: number
          product_url?: string | null
          quantity?: number
          seller_id?: string
          seller_seen?: boolean | null
          sku?: string
          sourcing_request_id?: string | null
          updated_at?: string
          variants?: Json | null
          video_url?: string | null
          weight?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_sourcing_request_id_fkey"
            columns: ["sourcing_request_id"]
            isOneToOne: false
            referencedRelation: "sourcing_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          name: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_settings: {
        Row: {
          agent_commission_confirmed: number
          agent_commission_delivered: number
          cod_fee_per_delivery: number
          confirmed_order_rate: number
          created_at: string
          dropped_order_rate: number
          id: string
          is_global: boolean
          seller_id: string | null
          shipping_rate_1kg: number
          shipping_rate_2kg: number
          shipping_rate_3kg: number
          updated_at: string
        }
        Insert: {
          agent_commission_confirmed?: number
          agent_commission_delivered?: number
          cod_fee_per_delivery?: number
          confirmed_order_rate?: number
          created_at?: string
          dropped_order_rate?: number
          id?: string
          is_global?: boolean
          seller_id?: string | null
          shipping_rate_1kg?: number
          shipping_rate_2kg?: number
          shipping_rate_3kg?: number
          updated_at?: string
        }
        Update: {
          agent_commission_confirmed?: number
          agent_commission_delivered?: number
          cod_fee_per_delivery?: number
          confirmed_order_rate?: number
          created_at?: string
          dropped_order_rate?: number
          id?: string
          is_global?: boolean
          seller_id?: string | null
          shipping_rate_1kg?: number
          shipping_rate_2kg?: number
          shipping_rate_3kg?: number
          updated_at?: string
        }
        Relationships: []
      }
      seller_order_prefixes: {
        Row: {
          current_counter: number
          id: string
          prefix: string
          seller_id: string
        }
        Insert: {
          current_counter?: number
          id?: string
          prefix: string
          seller_id: string
        }
        Update: {
          current_counter?: number
          id?: string
          prefix?: string
          seller_id?: string
        }
        Relationships: []
      }
      seller_payment_methods: {
        Row: {
          binance_id: string | null
          binance_wallet_address: string | null
          cih_account_name: string | null
          cih_rib: string | null
          created_at: string
          id: string
          is_default: boolean
          method: string
          updated_at: string
          user_id: string
        }
        Insert: {
          binance_id?: string | null
          binance_wallet_address?: string | null
          cih_account_name?: string | null
          cih_rib?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          method: string
          updated_at?: string
          user_id: string
        }
        Update: {
          binance_id?: string | null
          binance_wallet_address?: string | null
          cih_account_name?: string | null
          cih_rib?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          method?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      seller_product_counters: {
        Row: {
          current_counter: number
          id: string
          seller_id: string
        }
        Insert: {
          current_counter?: number
          id?: string
          seller_id: string
        }
        Update: {
          current_counter?: number
          id?: string
          seller_id?: string
        }
        Relationships: []
      }
      seller_rates: {
        Row: {
          id: string
          rate_1kg: number
          rate_2kg: number
          rate_3kg: number
          rate_3kg_plus: number
          user_id: string
        }
        Insert: {
          id?: string
          rate_1kg?: number
          rate_2kg?: number
          rate_3kg?: number
          rate_3kg_plus?: number
          user_id: string
        }
        Update: {
          id?: string
          rate_1kg?: number
          rate_2kg?: number
          rate_3kg?: number
          rate_3kg_plus?: number
          user_id?: string
        }
        Relationships: []
      }
      sourcing_requests: {
        Row: {
          admin_seen: boolean | null
          created_at: string
          destination_country: string
          id: string
          landed_price: number | null
          notes: string | null
          payment_date: string | null
          payment_method: string | null
          payment_status: string
          product_created: boolean | null
          product_image_url: string | null
          product_name: string
          product_url: string
          product_weight: string | null
          quantity: number
          seller_id: string
          seller_price: number | null
          seller_seen: boolean | null
          seller_validated: boolean | null
          shipping_cost: number | null
          shipping_method: string
          source_product_id: string | null
          status: string
          total_price: number | null
          unit_price: number | null
          updated_at: string
          variants: Json | null
        }
        Insert: {
          admin_seen?: boolean | null
          created_at?: string
          destination_country?: string
          id?: string
          landed_price?: number | null
          notes?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_status?: string
          product_created?: boolean | null
          product_image_url?: string | null
          product_name: string
          product_url?: string
          product_weight?: string | null
          quantity?: number
          seller_id: string
          seller_price?: number | null
          seller_seen?: boolean | null
          seller_validated?: boolean | null
          shipping_cost?: number | null
          shipping_method?: string
          source_product_id?: string | null
          status?: string
          total_price?: number | null
          unit_price?: number | null
          updated_at?: string
          variants?: Json | null
        }
        Update: {
          admin_seen?: boolean | null
          created_at?: string
          destination_country?: string
          id?: string
          landed_price?: number | null
          notes?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_status?: string
          product_created?: boolean | null
          product_image_url?: string | null
          product_name?: string
          product_url?: string
          product_weight?: string | null
          quantity?: number
          seller_id?: string
          seller_price?: number | null
          seller_seen?: boolean | null
          seller_validated?: boolean | null
          shipping_cost?: number | null
          shipping_method?: string
          source_product_id?: string | null
          status?: string
          total_price?: number | null
          unit_price?: number | null
          updated_at?: string
          variants?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_requests_source_product_id_fkey"
            columns: ["source_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          read_at: string | null
          sender_id: string
          sender_type: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read_at?: string | null
          sender_id: string
          sender_type?: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read_at?: string | null
          sender_id?: string
          sender_type?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          created_at: string
          id: string
          issue_type: string
          related_id: string | null
          seller_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          issue_type?: string
          related_id?: string | null
          seller_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          issue_type?: string
          related_id?: string | null
          seller_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          id: string
          permission_key: string
          user_id: string
        }
        Insert: {
          id?: string
          permission_key: string
          user_id: string
        }
        Update: {
          id?: string
          permission_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      user_presence: {
        Row: {
          id: string
          is_active: boolean
          last_seen: string
          user_id: string
        }
        Insert: {
          id?: string
          is_active?: boolean
          last_seen?: string
          user_id: string
        }
        Update: {
          id?: string
          is_active?: boolean
          last_seen?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_next_order: {
        Args: {
          p_agent_id: string
          p_order_type?: string
          p_product_names?: string[]
        }
        Returns: {
          agent_id: string | null
          assigned_at: string | null
          attempt_count: number
          cancel_reason: string | null
          confirmation_status: string
          confirmed_at: string | null
          created_at: string
          customer_address: string | null
          customer_city: string
          customer_name: string
          customer_phone: string
          delivered_at: string | null
          delivery_status: string | null
          fragile: boolean | null
          id: string
          invoice_id: string | null
          last_activity_at: string | null
          last_price: number | null
          note: string | null
          offers: string | null
          order_id: string
          original_agent_id: string | null
          postpone_date: string | null
          postpone_note: string | null
          price: number
          product_name: string
          product_url: string | null
          quantity: number
          seller_id: string
          shipping_cost: number | null
          shipping_status: string | null
          source_sheet_id: string | null
          store_url: string | null
          total_amount: number
          updated_at: string
          video_url: string | null
          weight: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      generate_order_id: { Args: { p_seller_id: string }; Returns: string }
      generate_product_display_id: {
        Args: { p_seller_id: string }
        Returns: string
      }
      generate_product_sku: { Args: never; Returns: string }
      get_agent_rankings: {
        Args: never
        Returns: {
          agent_id: string
          agent_name: string
          confirmed_count: number
        }[]
      }
      get_user_permissions: { Args: { _user_id: string }; Returns: string[] }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      release_expired_order_locks: { Args: never; Returns: undefined }
      release_order_lock: {
        Args: { p_agent_id: string; p_order_id: string }
        Returns: undefined
      }
      touch_order_lock: {
        Args: { p_agent_id: string; p_order_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "seller" | "agent" | "custom"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "seller", "agent", "custom"],
    },
  },
} as const
