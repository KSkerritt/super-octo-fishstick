// 🎭 ADD YOUR CLIENT IMAGES HERE
const clientImages = [
            '/images/client1.jpg',
            '/images/client2.jpg',
            '/images/client3.jpg',
            '/images/client4.jpg',
            '/images/client5.jpg',
            '/images/client6.jpg',
            '/images/client7.jpg',
            '/images/client8.jpg',
            '/images/client9.jpg',
            '/images/client10.jpg',
            '/images/client11.jpg',
            '/images/client12.jpg',
            '/images/client13.jpg',
            '/images/client14.jpg',
            '/images/client15.jpg',
            '/images/client16.jpg',
            '/images/client17.jpg',
            '/images/client18.jpg',
            '/images/client19.jpg',
            '/images/client20.jpg',
            '/images/client21.jpg',
            '/images/client22.jpg'
    
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
