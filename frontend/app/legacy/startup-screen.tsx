type StartupScreenProps = {
  error?: string;
  onRetry?: () => void;
};

export function StartupScreen({ error = '', onRetry }: StartupScreenProps) {
  const failed = Boolean(error);

  return (
    <main
      id="nextBootstrapScreen"
      className={`next-bootstrap-screen${failed ? ' next-bootstrap-screen-error' : ''}`}
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
      aria-atomic="true"
      aria-busy={!failed}
    >
      <section
        className="next-bootstrap-card"
        aria-labelledby="nextBootstrapTitle"
      >
        <p className="next-bootstrap-brand" aria-hidden="true">
          36chan
        </p>
        {failed ? null : (
          <span className="next-bootstrap-spinner" aria-hidden="true" />
        )}
        <h1 id="nextBootstrapTitle">
          {failed ? 'Không thể tải 36chan' : 'Đang tải 36chan'}
        </h1>
        <p>
          {failed
            ? error
            : 'Đang tải đầy đủ bảng, bài viết và cài đặt của bạn…'}
        </p>
        {failed && onRetry ? (
          <button
            className="next-bootstrap-retry"
            type="button"
            onClick={onRetry}
          >
            Tải lại
          </button>
        ) : null}
      </section>
    </main>
  );
}
