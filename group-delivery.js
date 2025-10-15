// Group Delivery JS

// Ensure the CSS file is linked to the document
(function () {
  const cssFile = "group-delivery.css";
  const linkExists = Array.from(document.styleSheets).some(
    (sheet) => sheet.href && sheet.href.includes(cssFile)
  );

  if (!linkExists) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssFile;
    document.head.appendChild(link);
  }
})();

// Function to handle the submission process and display a confirmation message
document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    alert("Thank you for submitting the form. Your details have been recorded.");
    form.reset();
  });

  // Handle Hamburger Menu for smaller screens
  const ham = document.querySelector(".ham");
  const mnav = document.querySelector(".mnav");

  ham.addEventListener("click", () => {
    ham.classList.toggle("active");
    mnav.classList.toggle("active");
  });

  document.querySelectorAll(".nav-link").forEach((link) =>
    link.addEventListener("click", () => {
      ham.classList.remove("active");
      mnav.classList.remove("active");
    })
  );
});

// File input validation
function valid() {
  const receiptInput = document.getElementById("Reciept");
  if (receiptInput.files.length === 0) {
    alert("Please upload a valid receipt.");
  }
}

function valrc() {
  const idInput = document.getElementById("Identification");
  if (idInput.files.length === 0) {
    alert("Please upload a valid ID or Driver's Permit.");
  }
}

