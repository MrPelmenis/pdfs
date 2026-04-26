const CreateChart = (data = null, query = "") => {
    const defaultData = {
        nodes: [
        ],
        links: [
        ],
    };

    const chartData = data
        ? {
              nodes: [
                  { id: "query", loaded: true, style: { label: query || "Search", fillColor: "rgba(99,102,241,0.9)" } },
                  ...data.nodes,
              ],
              links: [
                  ...data.nodes.map((n) => ({
                      id: `q-${n.id}`,
                      from: "query",
                      to: n.id,
                      style: { fillColor: "rgba(99,102,241,0.4)", radius: 1 },
                  })),
                  ...data.links,
              ],
          }
        : defaultData;

    const chart = new window.NetChart({
        container: document.getElementById("megachart"),
        area: { style: { fillColor: "#202124" } },
        toolbar:     { enabled: false },
        interaction: { resizing: { enabled: false } },
        data:        { preloaded: chartData },
        layout: {
            mode: "radial",
            nodeSpacing: 50,
        },
        navigation: {
            initialNodes: ["query"],
            mode: "focusnodes",
            focusNodeExpansionRadius: 4,
        },
        style: {
            node: {
                fillColor: "rgba(28,124,213,0.8)",
                radius: 28,
            },
            nodeLabel: {
                backgroundStyle: { fillColor: "rgba(0,0,0,0.6)" },
                textStyle: { font: "11px sans-serif", fillColor: "white" },
                padding: 3,
                borderRadius: 3,
            },
            nodeStyleFunction: function(node) {
                if (node.id === "query") {
                    node.radius = 20;
                    node.fillColor = "rgba(255,255,1)";
                }
            },
            link: {
                fillColor: "rgba(255,255,255,0.15)",
                radius: 5,
            },
            linkStyleFunction: function(link) {
                if (!link.id.startsWith("q-")) {
                    link.fillColor = "rgba(255,200,50,0.6)";
                    link.radius = 5;
                    link.toDecoration = "arrow";
                }
            },
        },
        events: {
            onClick: function(event) {
                if (event.clickNode && event.clickNode.id !== "query") {
                    alert("node " + event.clickNode.id);
                }
            }
        }
    });

    return chart;
};

export default CreateChart;
