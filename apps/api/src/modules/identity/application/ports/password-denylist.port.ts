export interface PasswordDenylistPort {
  contains(normalizedPassword: string): Promise<boolean>;
}
