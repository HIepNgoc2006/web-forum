type AccountEmailNotificationStateOptions = {
  loggedIn: boolean;
  emailVerified: boolean;
  requested: boolean;
  email?: string;
};

export function accountEmailNotificationState({
  loggedIn,
  emailVerified,
  requested,
  email = '',
}: AccountEmailNotificationStateOptions) {
  const available = loggedIn && emailVerified;
  return {
    checked: available && requested,
    disabled: !available,
    statusText: !loggedIn
      ? 'Đăng nhập và xác nhận email để bật thông báo email.'
      : available
        ? `Thông báo sẽ gửi tới ${email}.`
        : 'Xác nhận email để bật thông báo email.',
  };
}
