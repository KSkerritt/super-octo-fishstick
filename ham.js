// Hamburger menu toggle functionality
const ham = document.querySelector(".ham");
const nav = document.querySelector(".nav");
const mnav = document.querySelector(".mnav");

ham.addEventListener("click", () => {
  ham.classList.toggle("active");
  // nav.classList.toggle("active");
  const isOpen = mnav.classList.toggle("active");
  ham.setAttribute("aria-expanded", isOpen ? "true" : "false");
});

document.querySelectorAll(".nav-link").forEach((n) =>
  n.addEventListener("click", () => {
    ham.classList.remove("active");
    mnav.classList.remove("active");
  })
);

// Dynamically generate Yuman fields (2-10) — only runs on pages with the group form
const formContainer = document.querySelector(".group");
if (formContainer) {
  const numYumans = 9;
  for (let i = 0; i < numYumans; i++) {
    const yumanFieldset = document.createElement('fieldset');
    const yumanLegend = document.createElement('legend');
    yumanLegend.textContent = `Yuman ${i + 2}`;
    yumanFieldset.appendChild(yumanLegend);

    const yumanDiv = document.createElement('div');
    yumanDiv.classList.add('fields');

    ['First Name', 'Last Name', 'Email', 'Phone', 'Costume Details'].forEach(labelText => {
      const fieldDiv = document.createElement('div');
      fieldDiv.classList.add('input-field');

      const label = document.createElement('label');
      label.textContent = labelText;
      fieldDiv.appendChild(label);

      const input = document.createElement('input');
      input.type = (labelText === 'Email') ? 'email' : 'text';
      input.id = `${labelText.toLowerCase().replace(" ", "_")}_${i + 2}`;
      input.name = `${labelText.toLowerCase().replace(" ", "_")}_${i + 2}`;
      fieldDiv.appendChild(input);

      yumanDiv.appendChild(fieldDiv);
    });

    yumanFieldset.appendChild(yumanDiv);
    formContainer.appendChild(yumanFieldset);
  }
}
