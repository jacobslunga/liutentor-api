export type ApiResponse<T> = {
  success: boolean;
  message: string;
  payload: T | null;
};
