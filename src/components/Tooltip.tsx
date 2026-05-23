import React, { useState } from "react";

export const Tooltip = ({
  children,
  content,
  position = "top",
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  position?: string;
}) => {
  const [isVisible, setIsVisible] = useState(false);

  const getPositionClasses = () => {
    if (position === "bottom") {
      return {
        tooltip:
          "absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 text-white bg-black/80 backdrop-blur-xl rounded-md whitespace-nowrap z-50 transition-opacity duration-150",
        arrow:
          "absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-b-2 border-transparent border-b-neutral-800",
      };
    }
    return {
      tooltip:
        "absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-white bg-black/80 backdrop-blur-xl rounded-md whitespace-nowrap z-50 transition-opacity duration-150",
      arrow:
        "absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-neutral-800",
    };
  };

  const { tooltip, arrow } = getPositionClasses();

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {children}
      </div>
      {isVisible && (
        <div className={tooltip} style={{ fontSize: "10px" }}>
          {content}
          <div className={arrow}></div>
        </div>
      )}
    </div>
  );
};
