// 🎭 ADD YOUR CLIENT IMAGES HERE
const clientImages = [
    '/images/client1.jpg',
    '/images/client2.jpg',
    '/images/client3.jpg',
    
];

function buildCarousel() {
    const track = document.getElementById('carouselTrack');
    if (!track) return; // Exit if no carousel on page
    
    const allImages = [...clientImages, ...clientImages];
    
    allImages.forEach((imgSrc, index) => {
        const item = document.createElement('div');
        item.className = 'carousel-item';
        item.innerHTML = `<img src="${imgSrc}" alt="Client delivery ${(index % clientImages.length) + 1}">`;
        track.appendChild(item);
    });
    
    track.style.animation = 'scroll 50s linear infinite';
}

buildCarousel();
