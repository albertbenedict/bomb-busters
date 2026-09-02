const saved = localStorage.getItem("bb-theme");
if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");

function updateThemeLabel() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  btn.textContent = isDark ? "Light mode" : "Dark mode";
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  updateThemeLabel();
  btn.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("bb-theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("bb-theme", "dark");
    }
    updateThemeLabel();
  });
});
