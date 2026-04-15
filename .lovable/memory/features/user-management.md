---
name: User Management
description: Display IDs for Sellers (AB-XX) with unique 2-letter prefix and global counter
type: feature
---
- Display ID format: `[PREFIX]-[COUNTER]` (e.g., AB-11)
- Prefix: 2 unique uppercase letters derived from name
  - Strategy 1: first letter of first name + iterate each letter of last name
  - Strategy 2: iterate all combinations first_name[i] + last_name[j]
  - Fallback: first two letters of first name
  - Prefix must be unique across all existing display_ids AND order prefixes
- Counter: Global sequence (`seller_display_id_seq`), represents total seller count
- DB function: `generate_seller_display_id(p_name)` with SECURITY DEFINER
- Edge function `generatePrefix()` mirrors same collision-avoidance logic
- Order prefix (`seller_order_prefixes`) should match display_id prefix
- Only sellers get display_ids; admins/agents show truncated UUIDs
