import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface TranslatorSelectOption {
  value: string;
  label: string;
}

interface TranslatorSelectProps {
  value: string;
  options: TranslatorSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  /** 下拉列表内容；默认取当前选中项的 label。 */
  triggerContent?: ReactNode;
  /** 列表展开方向：trigger 在右侧时用 end 对齐。 */
  align?: "start" | "end";
  triggerClassName?: string;
  listClassName?: string;
  disabled?: boolean;
}

/**
 * 浮窗内自绘下拉框。
 *
 * 不用原生 `<select>`：原生弹层是操作系统风格（亮白底、系统字体、系统阴影），
 * 在磨砂小浮窗里非常突兀；也不用 Radix Portal：浮窗窗口本身只有几百像素，
 * 弹层超出窗口会被系统裁掉。这里把列表做进文档流，窗口随内容自动长高即可完整可见。
 */
export function TranslatorSelect({
  value,
  options,
  onChange,
  ariaLabel,
  triggerContent,
  align = "start",
  triggerClassName,
  listClassName,
  disabled = false,
}: TranslatorSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Escape 只收起列表，不关闭整个浮窗。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) activeRef.current?.focus({ preventScroll: true });
  }, [open]);

  const selected = options.find((option) => option.value === value);

  return (
    <div className={`translator-select ${triggerClassName ?? ""}`} ref={containerRef} data-no-drag>
      <button
        type="button"
        className="translator-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
      >
        <span className="translator-select-value">{triggerContent ?? selected?.label ?? value}</span>
        <ChevronDown
          size={11}
          className={`translator-select-caret ${open ? "translator-select-caret--open" : ""}`}
        />
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          className={`translator-select-list translator-select-list--${align} ${listClassName ?? ""}`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  ref={isSelected ? activeRef : index === 0 ? activeRef : undefined}
                  className={`translator-select-option ${isSelected ? "is-selected" : ""}`}
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                >
                  <span className="translator-select-option-label">{option.label}</span>
                  {isSelected ? <Check size={11} className="translator-select-check" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
