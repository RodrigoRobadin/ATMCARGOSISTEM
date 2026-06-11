import React, { useId, useMemo } from 'react';
import {
  LOGISTICS_CARRIER_OPTIONS,
  LOGISTICS_LOCATION_OPTIONS,
} from '../data/logisticsCatalog';

export default function LogisticsAutocomplete({
  value,
  onChange,
  readOnly = false,
  disabled = false,
  kind = 'location',
  includeTypes,
  placeholder,
  className = '',
  inputClassName = '',
}) {
  const rawId = useId();
  const listId = `logistics-options-${rawId.replace(/:/g, '')}`;
  const isDisabled = disabled || readOnly;

  const options = useMemo(() => {
    if (kind === 'carrier') return LOGISTICS_CARRIER_OPTIONS;
    const allowed = Array.isArray(includeTypes) && includeTypes.length
      ? new Set(includeTypes)
      : null;
    return LOGISTICS_LOCATION_OPTIONS.filter((option) => !allowed || allowed.has(option.type));
  }, [includeTypes, kind]);

  return (
    <div className={className}>
      <input
        list={isDisabled ? undefined : listId}
        value={value ?? ''}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
        className={
          inputClassName ||
          `w-full border rounded-lg px-2 py-1 text-sm focus:outline-none ${
            isDisabled
              ? 'bg-slate-50 cursor-not-allowed'
              : 'focus:ring-2 focus:ring-black/10'
          }`
        }
      />
      {!isDisabled ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option
              key={`${option.value}-${option.label || option.name || option.type || kind}`}
              value={option.value}
              label={option.label || option.name || ''}
            />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
