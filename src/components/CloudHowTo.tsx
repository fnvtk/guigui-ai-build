import { useEffect } from "react";
import { useStore } from "@/state/store";

export function CloudHowTo() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    if (state.cloudHowTo) dispatch({ type: "cloudHowTo", open: false });
  }, [state.cloudHowTo, dispatch]);
  return null;
}
