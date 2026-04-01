import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onWheel, onChange, value, ...props }, ref) => {
    const isNumber = type === "number";
    const [internalValue, setInternalValue] = React.useState<string>("");

    // Sync internal state when parent value changes (but not when field is empty and value is 0)
    React.useEffect(() => {
      if (isNumber) {
        const v = value ?? "";
        setInternalValue(String(v));
      }
    }, [value, isNumber]);

    if (isNumber) {
      return (
        <input
          type="text"
          inputMode="decimal"
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className,
          )}
          ref={ref}
          value={internalValue}
          onChange={(e) => {
            const raw = e.target.value;
            // Allow empty, digits, decimal point, and negative sign
            if (raw === "" || raw === "-" || raw === "." || raw === "-." || /^-?\d*\.?\d*$/.test(raw)) {
              setInternalValue(raw);
              if (onChange) {
                // Create a synthetic event with the raw value so parent handlers work
                onChange(e);
              }
            }
          }}
          onWheel={(e) => {
            (e.target as HTMLInputElement).blur();
            onWheel?.(e as any);
          }}
          {...props}
        />
      );
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        value={value}
        onChange={onChange}
        onWheel={onWheel}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
