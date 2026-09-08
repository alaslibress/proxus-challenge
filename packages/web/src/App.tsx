import { useState } from "react";
import { ArtifactWorkspace } from "./components/ArtifactWorkspace.tsx";
import { Chat } from "./components/Chat.tsx";
import { Sidebar } from "./components/Sidebar.tsx";

export function App() {
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  return (
    <div
      className="grid h-screen min-h-screen overflow-hidden bg-canvas text-ink"
      style={{
        gridTemplateColumns: selectedArtifactId === null
          ? "252px minmax(0, 1fr)"
          : "252px minmax(0, 1fr) 420px"
      }}
    >
      <Sidebar
        selectedArtifactId={selectedArtifactId}
        onSelectArtifact={(id) => setSelectedArtifactId((current) => current === id ? null : id)}
      />
      {selectedArtifactId !== null && (
        <ArtifactWorkspace
          artifactId={selectedArtifactId}
          onClose={() => setSelectedArtifactId(null)}
        />
      )}
      <Chat />
    </div>
  );
}
