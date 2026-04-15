import { NodeMoveCard } from "./cards/NodeMoveCard";
import { AddArrowCard } from "./cards/AddArrowCard";
import { AddRectCard } from "./cards/AddRectCard";
import { SnapGuidesCard } from "./cards/SnapGuidesCard";
import { SelectionAlignCard } from "./cards/SelectionAlignCard";
import { RotateNodeCard } from "./cards/RotateNodeCard";

export function App() {
  return (
    <div className="page">
      <h1>Feature Animations</h1>
      <div className="cardsGrid">
        <AddArrowCard />
        <AddRectCard />
        <SnapGuidesCard />
        <SelectionAlignCard />
        <RotateNodeCard />
        <NodeMoveCard />
      </div>
    </div>
  );
}
