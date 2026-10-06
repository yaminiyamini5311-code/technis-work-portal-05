import { useState } from "react";

export function useExclusiveSelect(initialState = { department: "", program: "" }) {
  const [values, setValues] = useState(initialState);

  const setDepartment = (value) => {
    setValues(prev => ({
      ...prev,
      department: value,
      program: value ? "" : prev.program
    }));
  };

  const setProgram = (value) => {
    setValues(prev => ({
      ...prev,
      program: value,
      department: value ? "" : prev.department
    }));
  };

  const reset = () => {
    setValues(initialState);
  };

  return {
    department: values.department,
    program: values.program,
    setDepartment,
    setProgram,
    reset,
    isDepartmentDisabled: !!values.program,
    isProgramDisabled: !!values.department
  };
}
