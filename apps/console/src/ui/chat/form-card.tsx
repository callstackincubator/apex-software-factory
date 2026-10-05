import { useId, useState } from "react";
import type { ChatField, ChatForm, FormValue } from "../../shared/schema.ts";

type Values = Record<string, FormValue | undefined>;

/** A form is answered with one click when it is a single choice and nothing else. */
function isSingleChoice(form: ChatForm): boolean {
  const [only] = form.fields;
  return form.fields.length === 1 && only?.type === "string" && only.options.length > 0;
}

function filled(value: FormValue | undefined): boolean {
  if (value === undefined || value === "") return false;
  return !(Array.isArray(value) && value.length === 0);
}

/** What the agent asks, as inputs: choices as buttons, anything else as a plain input. */
export function FormCard({
  form,
  disabled,
  onAnswer,
}: {
  readonly form: ChatForm;
  readonly disabled: boolean;
  readonly onAnswer: (formId: string, answer: Record<string, FormValue>) => void;
}) {
  const [values, setValues] = useState<Values>({});
  const set = (key: string, value: FormValue | undefined) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const answer = (override: Values = {}) => {
    const merged = { ...values, ...override };
    const out: Record<string, FormValue> = {};
    for (const field of form.fields) {
      const value = merged[field.key];
      if (value !== undefined && value !== "") out[field.key] = value;
    }
    onAnswer(form.id, out);
  };

  const ready = form.fields.every((f) => !f.required || filled(values[f.key]));
  const single = isSingleChoice(form);

  return (
    <form
      className="chat-form"
      aria-label={form.title === "" ? "Question" : form.title}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !disabled) answer();
      }}
    >
      {form.fields.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={values[field.key]}
          disabled={disabled}
          onChange={(value) => set(field.key, value)}
          onPick={single ? (value) => answer({ [field.key]: value }) : undefined}
        />
      ))}
      {single && form.fields[0]?.custom !== true ? null : (
        <button className="button" type="submit" disabled={disabled || !ready}>
          Answer
        </button>
      )}
    </form>
  );
}

function FieldInput({
  field,
  value,
  disabled,
  onChange,
  onPick,
}: {
  readonly field: ChatField;
  readonly value: FormValue | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: FormValue | undefined) => void;
  /** Set for a single-choice form: a click answers at once. */
  readonly onPick: ((value: string) => void) | undefined;
}) {
  const id = useId();
  const label = field.title ?? field.key;

  if (field.type === "boolean") {
    return (
      <label className="chat-check">
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
    );
  }

  if (field.type === "multiselect") {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <fieldset className="chat-field" disabled={disabled}>
        <legend>{label}</legend>
        {field.description === undefined ? null : <p className="hint">{field.description}</p>}
        {field.options.map((option) => (
          <label key={option.value} className="chat-check">
            <input
              type="checkbox"
              checked={chosen.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...chosen, option.value]
                    : chosen.filter((v) => v !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    );
  }

  const choices = field.type === "string" ? field.options : [];
  const numeric = field.type === "number" || field.type === "integer";
  return (
    <div className="chat-field">
      <label htmlFor={id}>{label}</label>
      {field.description === undefined ? null : <p className="hint">{field.description}</p>}
      {choices.length === 0 ? null : (
        <div className="chat-options" role="group" aria-label={label}>
          {choices.map((option) => (
            <button
              key={option.value}
              className={`button button-secondary${value === option.value ? " is-chosen" : ""}`}
              type="button"
              aria-pressed={onPick === undefined ? value === option.value : undefined}
              disabled={disabled}
              title={option.description}
              onClick={() => (onPick === undefined ? onChange(option.value) : onPick(option.value))}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {choices.length > 0 && !field.custom ? null : (
        <input
          id={id}
          type={numeric ? "number" : "text"}
          step={field.type === "integer" ? 1 : undefined}
          placeholder={
            field.placeholder ?? (choices.length > 0 ? "Or write your own answer" : undefined)
          }
          disabled={disabled}
          value={typeof value === "string" || typeof value === "number" ? value : ""}
          onChange={(event) => {
            const text = event.target.value;
            onChange(numeric && text !== "" ? Number(text) : text);
          }}
        />
      )}
    </div>
  );
}
