
import { Check } from "lucide-react";

const PermissionCard = ({
  icon: Icon,
  title,
  description,
  granted,
  onRequest,
  buttonText = "授予权限",
}) => {
  return (
    <div className="border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-md p-2 bg-white dark:bg-[#2c2c2e] shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3 h-3 text-[#0071e3] flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] text-heading truncate">
              {title}
            </h3>
            <p className="text-xs text-[#86868b] truncate">
              {description}
            </p>
          </div>
        </div>
        {granted ? (
          <div className="text-[#34c759] flex items-center gap-1 flex-shrink-0">
            <Check className="w-3 h-3" />
            <span className="text-xs font-medium">已授予</span>
          </div>
        ) : (
          <button
            onClick={onRequest}
            className="px-2 py-1 bg-[#0071e3] hover:bg-[#0077ed] text-white text-xs font-medium rounded transition-colors flex-shrink-0"
          >
            {buttonText}
          </button>
        )}
      </div>
    </div>
  );
};

export default PermissionCard;
