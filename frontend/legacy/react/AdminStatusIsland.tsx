type AdminStatusIslandProps = {
  label?: string;
};

/**
 * Low-risk React island: static admin tooling status chip.
 * No routing, no API calls, no session/auth logic.
 */
export function AdminStatusIsland({ label = 'React island: sẵn sàng' }: AdminStatusIslandProps) {
  return (
    <p className="muted react-island-status" data-react-island-ready="true" role="status">
      {label}
    </p>
  );
}
