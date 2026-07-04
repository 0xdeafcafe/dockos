import { useRpcQuery } from "../../rpc/hooks.ts";
import { TermScroll } from "../../ui/scroll.tsx";

// The container's own compose service definition, verbatim from the compose file it was created
// from (via the com.docker.compose.service label) — image, env, ports, volumes, networks, deps.
export function ComposeTab({ containerId }: { containerId: string }) {
  const { data } = useRpcQuery("containers.compose", { id: containerId }, {});
  const yaml = data?.yaml ?? "";
  const lines = yaml
    ? yaml.split("\n")
    : [data ? "— not created from a compose file —" : "…"];
  return (
    <div className="compose">
      <div className="detail__band">
        <span>
          ◈ service <b>{data?.service ?? "—"}</b>
        </span>
        <span className="detail__dim">verbatim from the compose file · read-only</span>
      </div>
      <TermScroll
        lines={lines.map((l, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- yaml rows are positional
          <span className="composeline" key={i}>
            {l || " "}
          </span>
        ))}
      />
    </div>
  );
}
