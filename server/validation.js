import { appError } from './http.js';

export function requiredText(value, label, max = 240) {
  const text = String(value ?? '').trim();
  if (!text) throw appError(`${label} é obrigatório.`, 422, 'VALIDATION_ERROR');
  if (text.length > max) throw appError(`${label} excede ${max} caracteres.`, 422, 'VALIDATION_ERROR');
  return text;
}

export function optionalText(value, max = 1000) {
  const text = String(value ?? '').trim();
  if (text.length > max) throw appError(`Campo excede ${max} caracteres.`, 422, 'VALIDATION_ERROR');
  return text || null;
}

export function email(value, { required = false } = {}) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text && !required) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw appError('Informe um e-mail válido.', 422, 'VALIDATION_ERROR');
  return text;
}

export function phone(value) {
  const text = requiredText(value, 'WhatsApp', 30);
  if (text.replace(/\D/g, '').length < 10) throw appError('Informe um WhatsApp válido.', 422, 'VALIDATION_ERROR');
  return text;
}

export function integer(value, label, { min = 1, optional = false } = {}) {
  if ((value === '' || value == null) && optional) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) throw appError(`${label} inválido.`, 422, 'VALIDATION_ERROR');
  return parsed;
}

export function cents(value, label = 'Valor') {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) throw appError(`${label} inválido.`, 422, 'VALIDATION_ERROR');
  return Math.round(parsed * 100);
}

export function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw appError(`${label} inválido.`, 422, 'VALIDATION_ERROR');
  return value;
}
