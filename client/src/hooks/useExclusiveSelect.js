import { useState } from "react";

export function useExclusiveSelect(initialState = { student: "", program: "", department: "" }) {
  const [values, setValues] = useState(initialState);

  const setStudent = (value) => {
    setValues(prev => ({
      ...prev,
      student: value,
      program: value ? "" : prev.program
    }));
  };

  const setProgram = (value) => {
    setValues(prev => ({
      ...prev,
      program: value,
      student: value ? "" : prev.student,
      department: value ? "" : prev.department
    }));
  };

  const setDepartment = (value) => {
    setValues(prev => ({
      ...prev,
      department: value,
      program: value ? "" : prev.program
    }));
  };

  const reset = () => {
    setValues(initialState);
  };

  return {
    student: values.student,
    program: values.program,
    department: values.department,
    setStudent,
    setProgram,
    setDepartment,
    reset,
    isStudentDisabled: !!values.program,
    isProgramDisabled: !!values.student || !!values.department,
    isDepartmentDisabled: !!values.program
  };
}
