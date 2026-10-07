import { useState } from "react";

export function useExclusiveSelect(initialState = { student: "", program: "" }) {
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
      student: value ? "" : prev.student
    }));
  };

  const reset = () => {
    setValues(initialState);
  };

  return {
    student: values.student,
    program: values.program,
    setStudent,
    setProgram,
    reset,
    isStudentDisabled: !!values.program,
    isProgramDisabled: !!values.student
  };
}
