// Hamburger menu toggle functionality
const ham = document.querySelector(".ham");
const nav = document.querySelector(".nav");
const mnav = document.querySelector(".mnav");

ham.addEventListener("click", () => {
  ham.classList.toggle("active");
  // nav.classList.toggle("active");
  mnav.classList.toggle("active");
});

document.querySelectorAll(".nav-link").forEach((n) =>
  n.addEventListener("click", () => {
    ham.classList.remove("active");
    mnav.classList.remove("active");
  })
);

// JavaScript to dynamically generate Yuman fields (2-10)
const formContainer = document.querySelector(".group"); // The div to hold the dynamically generated fields
const numYumans = 9; // We want fields for Yuman 2-10 (9 additional)

for (let i = 0; i < numYumans; i++) {
  const yumanFieldset = document.createElement('fieldset');
  const yumanLegend = document.createElement('legend');
  yumanLegend.textContent = `Yuman ${i + 2}`; // Label "Yuman 2", "Yuman 3", etc.
  yumanFieldset.appendChild(yumanLegend);

  const yumanDiv = document.createElement('div');
  yumanDiv.classList.add('fields');
  
  // Create Yuman fields (First Name, Last Name, Email, Phone, Costume)
  ['First Name', 'Last Name', 'Email', 'Phone', 'Costume Details'].forEach(labelText => {
    const fieldDiv = document.createElement('div');
    fieldDiv.classList.add('input-field');

    const label = document.createElement('label');
    label.textContent = labelText;
    fieldDiv.appendChild(label);

    const input = document.createElement('input');
    input.type = (labelText === 'Email') ? 'email' : 'text'; // Different input types for email
    input.id = `${labelText.toLowerCase().replace(" ", "_")}_${i + 2}`;
    input.name = `${labelText.toLowerCase().replace(" ", "_")}_${i + 2}`;
    fieldDiv.appendChild(input);
    
    yumanDiv.appendChild(fieldDiv);
  });

  yumanFieldset.appendChild(yumanDiv);
  formContainer.appendChild(yumanFieldset); // Append the fieldset to the group container
}
