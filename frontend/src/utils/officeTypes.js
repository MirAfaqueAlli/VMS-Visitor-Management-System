// frontend/src/utils/officeTypes.js
// Office type of a unit — tender 1.1.3 asks for "Office wise visitors
// (Units / Corporate / Training Centre wise)". Stored in units.type.
export const OFFICE_TYPES = [
  { value: 'UNIT',            label: 'Unit / Power House' },
  { value: 'CORPORATE',       label: 'Corporate Office' },
  { value: 'TRAINING_CENTRE', label: 'Training Centre' },
  { value: 'OTHER',           label: 'Other Office' },
];

export const officeTypeLabel = (value) =>
  OFFICE_TYPES.find((t) => t.value === value)?.label ?? OFFICE_TYPES[0].label;
