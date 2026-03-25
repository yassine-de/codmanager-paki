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
          name?: string
          orders_count?: number
          seller_id?: string
          sheet_name?: string
          sheet_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          agent_id: string | null
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
          last_price: number | null
          note: string | null
          offers: string | null
          order_id: string
          postpone_date: string | null
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
        }
        Insert: {
          agent_id?: string | null
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
          last_price?: number | null
          note?: string | null
          offers?: string | null
          order_id: string
          postpone_date?: string | null
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
        }
        Update: {
          agent_id?: string | null
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
          last_price?: number | null
          note?: string | null
          offers?: string | null
          order_id?: string
          postpone_date?: string | null
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
        }
        Relationships: []
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
      seller_rates: {
        Row: {
          id: string
          rate_1kg: number
          rate_2kg: number
          rate_3kg: number
          user_id: string
        }
        Insert: {
          id?: string
          rate_1kg?: number
          rate_2kg?: number
          rate_3kg?: number
          user_id: string
        }
        Update: {
          id?: string
          rate_1kg?: number
          rate_2kg?: number
          rate_3kg?: number
          user_id?: string
        }
        Relationships: []
      }
      sourcing_requests: {
        Row: {
          created_at: string
          destination_country: string
          id: string
          landed_price: number | null
          notes: string | null
          product_image_url: string | null
          product_name: string
          product_url: string
          quantity: number
          seller_id: string
          seller_price: number | null
          seller_seen: boolean | null
          seller_validated: boolean | null
          shipping_cost: number | null
          shipping_method: string
          status: string
          total_price: number | null
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          destination_country?: string
          id?: string
          landed_price?: number | null
          notes?: string | null
          product_image_url?: string | null
          product_name: string
          product_url?: string
          quantity?: number
          seller_id: string
          seller_price?: number | null
          seller_seen?: boolean | null
          seller_validated?: boolean | null
          shipping_cost?: number | null
          shipping_method?: string
          status?: string
          total_price?: number | null
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          destination_country?: string
          id?: string
          landed_price?: number | null
          notes?: string | null
          product_image_url?: string | null
          product_name?: string
          product_url?: string
          quantity?: number
          seller_id?: string
          seller_price?: number | null
          seller_seen?: boolean | null
          seller_validated?: boolean | null
          shipping_cost?: number | null
          shipping_method?: string
          status?: string
          total_price?: number | null
          unit_price?: number | null
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
      generate_order_id: { Args: { p_seller_id: string }; Returns: string }
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
