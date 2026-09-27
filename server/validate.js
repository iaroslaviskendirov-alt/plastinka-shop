export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * Проверяет объект по схеме вида { field: { type, required, min, max, pattern, oneOf } }.
 * Возвращает очищенный объект или бросает HttpError 400 со списком ошибок по полям.
 */
export function validate(input, schema, { partial = false } = {}) {
  const out = {};
  const errors = {};
  for (const [key, rule] of Object.entries(schema)) {
    let value = input?.[key];
    if (value === undefined || value === null || value === '') {
      if (rule.required && !partial) errors[key] = 'Обязательное поле';
      continue;
    }
    if (rule.type === 'int') {
      value = Number(value);
      if (!Number.isInteger(value)) { errors[key] = 'Должно быть целым числом'; continue; }
      if (rule.min !== undefined && value < rule.min) { errors[key] = `Не меньше ${rule.min}`; continue; }
      if (rule.max !== undefined && value > rule.max) { errors[key] = `Не больше ${rule.max}`; continue; }
    } else {
      value = String(value).trim();
      if (rule.max && value.length > rule.max) { errors[key] = `Не длиннее ${rule.max} символов`; continue; }
      if (rule.min && value.length < rule.min) { errors[key] = `Не короче ${rule.min} символов`; continue; }
      if (rule.pattern && !rule.pattern.test(value)) { errors[key] = rule.message || 'Неверный формат'; continue; }
      if (rule.oneOf && !rule.oneOf.includes(value)) { errors[key] = `Допустимо: ${rule.oneOf.join(', ')}`; continue; }
    }
    out[key] = value;
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Проверьте поля формы', errors);
  return out;
}
