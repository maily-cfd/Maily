'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { 
  Calendar, 
  Video,
  CalendarDays,
  Mail,
  X,
  Check,
  Search,
  Plus,
  ChevronDown,
  Database,
  ListTodo,
  Clock,
  ExternalLink,
  Shield,
  Zap,
  Info
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Custom SVG Brand Icons
export const BrandIcons = {
  GoogleCalendar: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 192 192" className={className}>
      <path fill="#bbe2ff" d="M32 36.8C32 20.894 44.894 8 60.8 8h70.4C147.106 8 160 20.894 160 36.8v30.4c0 15.906-12.894 28.8-28.8 28.8H60.8C44.894 96 32 83.106 32 67.2z"/>
      <path fill="#3c90ff" d="M19.867 49.392C17.818 33.82 29.94 20 45.645 20h100.71c15.706 0 27.827 13.82 25.778 29.392L166 96l6.133 46.608C174.182 158.18 162.061 172 146.355 172H45.645c-15.706 0-27.827-13.82-25.778-29.392L26 96z"/>
      <mask id="gc-a" width="154" height="152" x="19" y="20" maskUnits="userSpaceOnUse" style={{ maskType: 'alpha' }}>
        <path fill="#3c90ff" d="M19.867 49.392C17.818 33.82 29.94 20 45.645 20h100.71c15.706 0 27.827 13.82 25.778 29.392L166 96l6.133 46.608C174.182 158.18 162.061 172 146.355 172H45.645c-15.706 0-27.827-13.82-25.778-29.392L26 96z"/>
      </mask>
      <g mask="url(#gc-a)">
        <path fill="url(#gc-b)" d="M0 0h166v76H0z" transform="matrix(1 0 0 -1 13 172)"/>
      </g>
      <mask id="gc-c" width="154" height="152" x="19" y="20" maskUnits="userSpaceOnUse" style={{ maskType: 'alpha' }}>
        <path fill="#3186ff" d="M19.867 49.392C17.818 33.82 29.94 20 45.645 20h100.71c15.706 0 27.827 13.82 25.778 29.392L166 96l6.133 46.608C174.182 158.18 162.061 172 146.355 172H45.645c-15.706 0-27.827-13.82-25.778-29.392L26 96z"/>
      </mask>
      <g mask="url(#gc-c)">
        <path fill="url(#gc-d)" d="M32 27.2C32 16.596 40.596 8 51.2 8h89.6c10.604 0 19.2 8.596 19.2 19.2V96H32z" filter="url(#gc-e)"/>
      </g>
      <path fill="#fff" d="M75.353 133.336q-6.282 0-10.777-2.043t-7.61-5.465q-3.065-3.474-4.342-6.793T51.603 115a2.07 2.07 0 0 1 1.021-1.124l5.67-2.247q.714-.357 1.43-.102.714.204 1.685 2.349 1.022 2.145 2.86 4.546a14.3 14.3 0 0 0 4.495 3.728q2.606 1.328 6.435 1.328 6.18 0 9.807-3.575 3.677-3.575 3.677-9.091 0-5.976-3.882-9.194-3.881-3.269-10.266-3.269h-5.362a1.9 1.9 0 0 1-1.328-.51q-.51-.562-.511-1.277v-5.465q0-.767.51-1.277a1.82 1.82 0 0 1 1.329-.562h4.647q5.721 0 9.194-3.116t3.473-8.07q0-4.902-3.116-7.916t-8.58-3.014q-3.065 0-5.312 1.022a11.5 11.5 0 0 0-3.882 2.86 22.7 22.7 0 0 0-2.809 3.78q-1.174 1.941-1.89 2.145-.714.153-1.379-.255l-5.363-2.605q-.664-.358-.868-1.124t1.226-3.575q1.481-2.86 4.494-5.823a21 21 0 0 1 7.049-4.597q4.035-1.635 9.398-1.634 9.96 0 15.782 5.26 5.823 5.21 5.823 13.791 0 5.925-2.86 10.266-2.81 4.34-7.968 6.13v.204q6.231 1.838 9.806 6.741 3.627 4.853 3.626 11.594 0 9.654-6.742 15.834-6.74 6.18-17.57 6.18zm51.25-1.175q-.868 0-1.533-.664a2.25 2.25 0 0 1-.612-1.583V73.118l-11.492 8.274q-.614.46-1.431.307a1.96 1.96 0 0 1-1.225-.766l-3.32-4.7a1.98 1.98 0 0 1-.358-1.43q.153-.816.817-1.276l20.379-14.557q.256-.204.562-.306.307-.153.715-.153h4.291q.868 0 1.379.613.562.56.562 1.43v69.36q0 .92-.664 1.583a2 2 0 0 1-1.533.664z"/>
      <defs>
        <linearGradient id="gc-b" x1="83" x2="83" y1="76" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4fa0ff"/>
          <stop offset="1" stopColor="#3186ff"/>
        </linearGradient>
        <linearGradient id="gc-d" x1="89.06" x2="89.06" y1="21.75" y2="96.39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a9a8ff"/>
          <stop offset=".8" stopColor="#3c90ff"/>
        </linearGradient>
        <filter id="gc-e" width="152" height="112" x="20" y="-4" colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix"/>
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
          <feGaussianBlur result="effect1_foregroundBlur_37330_7673" stdDeviation="6"/>
        </filter>
      </defs>
    </svg>
  ),
  Notion: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" id="notion" className={className}>
      <path fill="#000" fillRule="evenodd" d="m5.2,47.56s8,10.37,8.48,10.83c1.16,1.11,2.73,1.69,4.33,1.6,8.37-.42,27.54-1.38,35.57-1.78,3.11-.16,5.55-2.72,5.56-5.83l.1-35.5c0-1.99-1.03-3.83-2.72-4.87t0,0c-2.99-1.84-8.91-5.49-10.7-6.68-1.46-.97-3.2-1.43-4.96-1.32-5.96.38-23.45,1.51-30.85,1.98-2.96.19-5.24,2.62-5.24,5.54v34.78c0,.45.15.89.43,1.24h0Zm50.01-28.91v.02l-.1,33.7c0,.97-.77,1.77-1.74,1.82l-35.57,1.78c-.5.03-.99-.16-1.35-.5-.36-.34-.57-.82-.57-1.32V20.71c0-.97.75-1.77,1.72-1.82l35.67-2.06c.5-.03.99.15,1.36.5.36.34.57.82.57,1.32h0Zm-11.98,21.42v-13.72c-.63-.72-1.63-.67-3.07-1.11-.1-.03-.19-.11-.23-.21-.04-.1-.03-.22.03-.31,1.72-2.53,6.63-.95,9.83-1.96.09-.03.2-.02.28.05.08.07.11.17.09.27-.31,1.39-1.4,2.1-2.95,2.4v22.57c0,.75-.45,1.44-1.15,1.72-.64.26-1.31.54-1.31.54-1.54.8-3.43.29-4.37-1.17l-11.46-17.87v16.27c.62.72,1.63.67,3.07,1.11.1.03.19.11.23.21.04.1.03.22-.03.31-1.73,2.53-6.63.95-9.83,1.96-.09.04-.2.02-.28-.05-.08-.06-.11-.17-.09-.27.31-1.39,1.4-2.1,2.95-2.4v-21.31l-3.02-.29s.21-2.45,3.09-2.73c1.42-.14,5.13-.3,6.47-.36.3-.01.59.13.77.38l10.99,15.95h0ZM15.03,14.28c.55.42,1.24.63,1.93.59,5.09-.29,26.82-1.53,32.21-1.84.17-.01.31-.13.35-.29.04-.16-.03-.33-.17-.42-2.39-1.49-4.74-2.95-5.76-3.63-.73-.48-1.6-.71-2.48-.66,0,0-24.7,1.36-29.78,1.91-.64.07-.78.3-.8.39-.09.31.02.54.27.74,1.02.78,3.07,2.33,4.23,3.21h0Z"></path>
    </svg>
  ),
  NotionCalendar: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="94.5 88 312.85 325" className={className}>
      <path d="M398.579 135.841C404.242 141.152 407.35 148.439 407.35 156.355V372.638C407.35 372.725 407.347 372.812 407.343 372.9C407.329 373.178 407.3 373.455 407.3 373.733L407.325 373.859C407.325 386.91 397.107 398.225 384.27 399.798C383.352 399.948 382.433 400.062 381.489 400.125L169.818 412.937C169.151 412.975 168.497 413 167.842 413C167.767 413 167.695 412.994 167.622 412.987C167.55 412.981 167.477 412.975 167.402 412.975C167.251 412.975 167.103 412.981 166.955 412.987C166.807 412.994 166.659 413 166.508 413C158.97 413 151.91 410.231 146.461 405.109C140.559 399.559 137.275 391.944 137.275 383.688V373.405C137.275 371.316 136.872 370.196 134.443 370.196C134.443 370.196 127.786 370.322 127.094 370.322C118.687 370.322 110.822 367.227 104.744 361.513C98.1621 355.32 94.5378 346.837 94.5378 337.638L94.5 136.495C94.5 117.806 109.677 101.658 128.327 100.501L329.264 88.066C338.438 87.4996 347.134 90.5956 353.716 96.7752C360.297 102.955 363.921 111.425 363.921 120.637V126.993C363.921 126.993 363.795 129.12 366.552 129.032L377.563 128.365C385.453 127.861 392.916 130.53 398.579 135.841Z" fill="white"/>
      <path d="M128.454 357.071C122.803 357.008 117.782 355.562 113.881 351.924C113.881 351.924 113.868 351.924 113.856 351.899C113.403 351.458 112.975 351.006 112.572 350.552C109.489 347.028 107.815 342.51 107.815 337.627L107.777 136.484C107.777 124.843 117.593 114.397 129.209 113.679L330.12 101.245C330.561 101.22 330.988 101.207 331.429 101.207C336.45 101.207 341.132 103.019 344.706 106.392C345.196 106.858 345.662 107.336 346.09 107.84C346.837 108.692 347.5 109.602 348.08 110.564C347.501 109.609 346.834 108.702 346.09 107.852C349.098 111.351 350.746 115.806 350.746 120.639V125.787C350.746 125.787 350.872 130.003 346.694 130.28L346.719 130.305L161.928 141.884C148.375 142.727 137.364 154.469 137.364 168.049C137.364 168.049 137.288 353.699 137.275 354C137.137 357.071 134.607 357.071 132.518 357.071H128.454Z" fill="black"/>
      <path d="M394.126 373.546C394.151 373.244 394.176 372.941 394.176 372.639L394.126 155.274C394.05 154.129 393.861 153.009 393.546 151.939C392.817 149.434 391.457 147.182 389.532 145.382C386.776 142.802 383.177 141.405 379.313 141.405C378.974 141.405 378.633 141.417 378.294 141.443L163.854 154.884C163.779 154.889 163.703 154.902 163.628 154.914C163.527 154.93 163.426 154.947 163.326 154.947C156.505 155.652 150.792 161.617 150.326 168.451C150.301 168.753 150.301 169.043 150.301 169.345V382.318C150.301 382.42 150.307 382.519 150.314 382.616C150.32 382.711 150.326 382.804 150.326 382.896C150.464 387.667 152.365 392.021 155.75 395.205C158.77 398.049 162.646 399.66 166.837 399.875H167.504L381.83 386.899C381.893 386.899 381.956 386.889 382.019 386.88C382.065 386.873 382.111 386.866 382.158 386.862C382.174 386.862 382.191 386.861 382.208 386.861C388.538 385.691 393.684 380.002 394.126 373.546ZM183.927 376.339C176.59 376.855 170.096 374.364 170.297 364.748V215.08C170.297 209.946 174.526 206.661 179.194 206.421L365.747 195.233C370.404 194.994 374.216 198.367 374.216 203.036V352.968C374.216 358.455 372.845 365.516 363.406 365.881H363.381L363.368 365.893L183.927 376.339Z" fill="black"/>
      <path d="M227.066 252.787C218.406 253.322 215.462 259.932 215.474 270.09V271.876C214.441 272.119 213.576 272.349 212.53 272.41C206.291 272.799 201.79 267.733 201.778 258.644C201.766 244.744 214.221 231.658 237.952 230.188C259.081 228.875 272.606 239.082 272.631 257.089C272.643 270.636 261.392 280.247 250.311 283.26C271.098 284.282 279.771 295.873 279.795 310.66C279.819 335.97 261.307 350.319 232.722 352.106L232.029 352.154C210.547 353.491 195.465 345.338 195.453 331.255C195.453 323.236 201.327 316.444 210.159 315.897C210.852 315.849 211.545 315.994 212.238 315.946C213.99 330.283 223.697 335.557 233.391 334.961C242.745 334.378 249.325 328.084 249.313 319.165V318.813C249.301 304.901 237.685 304.209 220.193 303.516L217.408 286.93C233.683 283.954 241.82 278.631 241.808 269.008C241.808 258.668 236.067 252.253 227.066 252.811V252.787Z" fill="black"/>
      <path d="M305.181 245.959C287.859 250.965 284.041 243.358 285.938 235.388C296.325 232.958 323.341 224.854 333.558 221.196L333.68 327.987L352.57 330.732C352.57 337.683 348.605 342.032 341.501 342.482C335.614 342.846 321.93 343.345 315.349 343.758C305.132 344.39 286.424 345.921 286.424 345.921C285.901 344.524 285.731 343.114 285.731 341.862C285.731 338.472 287.105 334.998 291.606 333.478L305.29 329.056L305.193 245.971L305.181 245.959Z" fill="black"/>
    </svg>
  ),
  CalCom: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" xmlSpace="preserve" viewBox="0 0 512 512" className={className}>
      <path d="M458 512H56c-30.4 0-55-24.6-55-55V55C1 24.6 25.6 0 56 0h402c30.4 0 55 24.6 55 55v402c0 30.4-24.6 55-55 55" style={{ fill: '#fff' }}/>
      <path d="M162.8 347.3c-50.4 0-88.4-39.9-88.4-89.3s35.9-89.6 88.4-89.6c27.9 0 47 8.6 62.1 28l-24.3 20.1c-10.1-10.8-22.5-16.2-37.8-16.2-34.1 0-52.8 26.1-52.8 57.6s20.5 57.1 52.8 57.1c15.1 0 28-5.3 38.4-16.2l23.9 21c-14.5 18.9-34.3 27.5-62.3 27.5m166.4-131.2h32.7v128.1h-32.7v-18.7c-6.7 13.2-18.1 22.2-39.7 22.2-34.6 0-62.3-30.1-62.3-66.9 0-37 27.7-66.9 62.3-66.9 21.5 0 33 8.9 39.7 22.2zm1.1 64.5c0-20-13.8-36.6-35.4-36.6-20.8 0-34.4 16.7-34.4 36.6 0 19.4 13.6 36.6 34.4 36.6 21.4 0 35.4-16.7 35.4-36.6M385 164.3h32.7v179.6H385z" style={{ fill: '#242424' }}/>
    </svg>
  ),
  GoogleMeet: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 192 192" className={className}>
      <path fill="url(#gmeet-a)" d="M110.015 108.88c-6.829-4.718-6.921-14.778-.179-19.62L165 49.643c7.94-5.701 19-.038 19 9.737v77.755c0 9.675-10.861 15.359-18.821 9.859z"/>
      <path fill="url(#gmeet-b)" d="M8 71c0-24.3 19.7-44 44-44h64c11.046 0 20 8.954 20 20v98c0 11.046-8.954 20-20 20H28c-11.046 0-20-8.954-20-20z"/>
      <mask id="gmeet-e" width="129" height="138" x="8" y="27" maskUnits="userSpaceOnUse" style={{ maskType: 'luminance' }}>
        <path fill="#fff" d="M8 71c0-24.3 19.7-44 44-44h64c11.046 0 20 8.954 20 20v98c0 11.046-8.954 20-20 20H28c-11.046 0-20-8.954-20-20z"/>
      </mask>
      <g filter="url(#gmeet-c)" mask="url(#gmeet-e)">
        <path fill="url(#gmeet-f)" d="m73.906 99.198 110-63.198v124z"/>
      </g>
      <circle cx="38" cy="135" r="14" fill="#fff"/>
      <defs>
        <linearGradient id="gmeet-a" x1="128.8" x2="227.2" y1="104.44" y2="104.44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f6a100"/>
          <stop offset="1" stopColor="#ffbe00"/>
        </linearGradient>
        <linearGradient id="gmeet-f" x1="136.22" x2="78.5" y1="91.32" y2="91.19" gradientUnits="userSpaceOnUse">
          <stop offset=".15" stopColor="#ffb5e8"/>
          <stop offset="1" stopColor="#ffdbf5" stopOpacity="0"/>
        </linearGradient>
        <radialGradient id="gmeet-b" cx="0" cy="0" r="1" gradientTransform="matrix(-159.725 0 0 -135.852 160.325 96)" gradientUnits="userSpaceOnUse">
          <stop offset=".15" stopColor="#ffe921"/>
          <stop offset="1" stopColor="#fec700"/>
        </radialGradient>
        <filter id="gmeet-c" width="166" height="180" x="45.91" y="8" colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix"/>
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
          <feGaussianBlur result="effect1_foregroundBlur_37584_9338" stdDeviation="14"/>
        </filter>
      </defs>
    </svg>
  ),
  Slack: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" className={className}>
      <path d="M27.255 80.719c0 7.33-5.978 13.317-13.309 13.317C6.616 94.036.63 88.049.63 80.719s5.987-13.317 13.317-13.317h13.309zm6.709 0c0-7.33 5.987-13.317 13.317-13.317s13.317 5.986 13.317 13.317v33.335c0 7.33-5.986 13.317-13.317 13.317-7.33 0-13.317-5.987-13.317-13.317zm0 0" fill="#de1c59"/>
      <path d="M47.281 27.255c-7.33 0-13.317-5.978-13.317-13.309C33.964 6.616 39.951.63 47.281.63s13.317 5.987 13.317 13.317v13.309zm0 6.709c7.33 0 13.317 5.987 13.317 13.317s-5.986 13.317-13.317 13.317H13.946C6.616 60.598.63 54.612.63 47.281c0-7.33 5.987-13.317 13.317-13.317zm0 0" fill="#35c5f0"/>
      <path d="M100.745 47.281c0-7.33 5.978-13.317 13.309-13.317 7.33 0 13.317 5.987 13.317 13.317s-5.987 13.317-13.317 13.317h-13.309zm-6.709 0c0 7.33-5.987 13.317-13.317 13.317s-13.317-5.986-13.317-13.317V13.946C67.402 6.616 73.388.63 80.719.63c7.33 0 13.317 5.987 13.317 13.317zm0 0" fill="#2eb57d"/>
      <path d="M80.719 100.745c7.33 0 13.317 5.978 13.317 13.309 0 7.33-5.987 13.317-13.317 13.317s-13.317-5.987-13.317-13.317v-13.309zm0-6.709c-7.33 0-13.317-5.987-13.317-13.317s5.986-13.317 13.317-13.317h33.335c7.33 0 13.317 5.986 13.317 13.317 0 7.33-5.987 13.317-13.317 13.317zm0 0" fill="#ebb02e"/>
    </svg>
  ),
  Gmail: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 192 192" className={className}>
      <path fill="url(#gm-a)" d="M146 44h38v110c0 6.627-5.373 12-12 12h-20a6 6 0 0 1-6-6z"/>
      <path fill="#fc413d" d="M46 44H8v110c0 6.627 5.373 12 12 12h20a6 6 0 0 0 6-6z"/>
      <path fill="url(#gm-b)" d="M39.226 30.456c-8.033-6.752-20.018-5.714-26.77 2.319-6.752 8.032-5.714 20.017 2.319 26.77l76.078 63.949a8 8 0 0 0 10.295 0l76.078-63.95c8.032-6.752 9.07-18.737 2.318-26.77-6.752-8.032-18.737-9.07-26.769-2.318L96 78.18z"/>
      <defs>
        <linearGradient id="gm-a" x1="165" x2="165" y1="44" y2="166" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60d673"/>
          <stop offset=".17" stopColor="#42c868"/>
          <stop offset=".39" stopColor="#0ebc5f"/>
          <stop offset=".62" stopColor="#00a9bb"/>
          <stop offset=".86" stopColor="#3c90ff"/>
          <stop offset="1" stopColor="#3186ff"/>
        </linearGradient>
        <linearGradient id="gm-b" x1="8" x2="184" y1="46.13" y2="46.13" gradientUnits="userSpaceOnUse">
          <stop offset=".08" stopColor="#ff63a0"/>
          <stop offset=".3" stopColor="#fc413d"/>
          <stop offset=".5" stopColor="#fc413d"/>
          <stop offset=".65" stopColor="#fc413d"/>
          <stop offset=".72" stopColor="#fc5c30"/>
          <stop offset=".86" stopColor="#feb10c"/>
          <stop offset=".91" stopColor="#fec700"/>
          <stop offset=".96" stopColor="#ffdb0f"/>
        </linearGradient>
      </defs>
    </svg>
  )
};

// Definitive list of supported connectors (Phase 4 canonical)
export const SUPPORTED_APPS = [
  {
    id: 'gmail',
    name: 'Gmail',
    icon: BrandIcons.Gmail,
    color: '#EA4335',
    type: 'MCP',
    author: 'Google',
    uuid: 'gm-gmail-9a8b-7c6d-5e4f-3g2h1i0j9k8l',
    website: 'https://mail.google.com',
    documentation: 'https://developers.google.com/gmail/api',
    privacyPolicy: 'https://policies.google.com/privacy',
    description: 'Gmail is the core integration. Without it Boult cannot search your inbox, draft replies, send mail, label, or archive — every other workflow that touches email depends on this.',
    details: 'Connect Gmail to let Boult read your threads, draft replies in your voice, manage labels, archive cleanly, and send approved emails. Requires the four Gmail scopes (read / compose / send / modify) the agent depends on — completing the sign-in grants all four in one consent screen.',
    smartPrompt: "Search my inbox for any urgent emails from the last 24 hours and summarize them.",
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    icon: BrandIcons.GoogleCalendar,
    color: '#4285F4',
    type: 'MCP',
    author: 'Google',
    uuid: 'gc-0a8b-4c2d-9e1f-7h8i9j0k1l2m',
    website: 'https://calendar.google.com',
    documentation: 'https://developers.google.com/calendar',
    privacyPolicy: 'https://policies.google.com/privacy',
    description: 'Google Calendar MCP lets you connect tools to your Google Calendar workspace, so you can create, edit, search, and organize events straight from Boult.',
    details: 'Sync your Google Calendar to let Boult schedule meetings, find availability, and manage your daily agenda autonomously.',
    smartPrompt: "Check my calendar for tomorrow morning and summarize what my schedule looks like."
  },
  { 
    id: 'google_meet', 
    name: 'Google Meet', 
    icon: BrandIcons.GoogleMeet, 
    color: '#00897B',
    type: 'MCP',
    author: 'Google',
    uuid: 'gm-1b2c-3d4e-5f6g-7h8i9j0k1l2m',
    website: 'https://meet.google.com',
    documentation: 'https://developers.google.com/meet',
    privacyPolicy: 'https://policies.google.com/privacy',
    description: 'Google Meet gives Boult what happens after a call — transcripts, recordings, and who actually attended — plus instant meeting links on request.',
    details: 'Connect Google Meet to let Boult summarize a call from its transcript, pull the recording, check attendance, and spin up an instant meeting link. Scheduled meetings already get a Meet link from Google Calendar — this is the separate Meet connection that reaches everything a call leaves behind.',
    smartPrompt: "Summarize my last Google Meet call and list the action items."
  },
  { 
    id: 'notion', 
    name: 'Notion', 
    icon: BrandIcons.Notion, 
    color: '#000000',
    type: 'MCP',
    author: 'Notion',
    uuid: 'nt-2c3d-4e5f-6g7h-8i9j0k1l2m3n',
    website: 'https://notion.so',
    documentation: 'https://developers.notion.com',
    privacyPolicy: 'https://notion.so/privacy',
    description: 'Notion MCP lets you connect tools to your Notion workspace, so you can create, edit, search, and organize content straight from Boult.',
    details: 'Link your Notion workspace to enable Boult to create meeting notes, update project trackers, and append data to your pages.',
    smartPrompt: "Search my Notion workspace for any pages related to 'Product Roadmap' and give me a summary."
  },
  { 
    id: 'notion_calendar', 
    name: 'Notion Calendar', 
    icon: BrandIcons.NotionCalendar, 
    color: '#000000',
    type: 'MCP',
    author: 'Notion',
    uuid: 'nc-3d4e-5f6g-7h8i-9j0k1l2m3n4o',
    website: 'https://calendar.notion.so',
    documentation: 'https://developers.notion.com',
    privacyPolicy: 'https://notion.so/privacy',
    description: 'Notion Calendar MCP provides unified time management across Notion pages and external timelines straight from Boult.',
    details: 'Integrate Notion Calendar to bridge your project timelines with your personal schedule for comprehensive mission planning.',
    smartPrompt: "Combine my Notion project timelines with my calendar and let me know if I have any overlapping deadlines next week."
  },
  { 
    id: 'slack', 
    name: 'Slack', 
    icon: BrandIcons.Slack, 
    color: '#E01E5A',
    type: 'MCP',
    author: 'Slack',
    uuid: 'sl-4e5f-6g7h-8i9j-0k1l2m3n4o5p',
    website: 'https://slack.com',
    documentation: 'https://api.slack.com',
    privacyPolicy: 'https://slack.com/trust/privacy/privacy-policy',
    description: 'Slack MCP lets you read and write Slack conversations in Boult to centralize communication and team coordination.',
    details: 'Connect Slack to allow Boult to monitor channels, draft messages, and coordinate across your teams.',
    smartPrompt: "Summarize the latest 5 messages from my most active Slack channel."
  },
  { 
    id: 'cal_com', 
    name: 'Cal.com', 
    icon: BrandIcons.CalCom, 
    color: '#ffffff',
    type: 'MCP',
    author: 'Cal.com',
    uuid: 'cal-5f6g-7h8i-9j0k-1l2m3n4o5p6q',
    website: 'https://cal.com',
    documentation: 'https://developer.cal.com',
    privacyPolicy: 'https://cal.com/privacy',
    description: 'Cal.com MCP enables professional scheduling with automated link generation and booking straight from Boult.',
    details: 'Integrate Cal.com to let Boult share your booking links and automatically handle appointment scheduling with external partners.',
    smartPrompt: "Share my Cal.com booking link and check if there's any availability for a 30-min call this Friday afternoon.",
    comingSoon: false
  }
];

// V3 providers redirect directly; legacy providers return { url } from /auth
export const V3_DIRECT_ROUTES: Record<string, string> = {
  gmail:            '/api/boult/v3/oauth/gmail',
  google_calendar:  '/api/boult/v3/oauth/gcal',
  // Meet is its OWN connection, not derived from Calendar. Calendar still puts
  // Meet links on scheduled events; this grants the Meet API v2 (transcripts,
  // recordings, attendance, standalone spaces).
  google_meet:      '/api/boult/v3/oauth/gmeet',
  slack:            '/api/boult/v3/oauth/slack',
  notion:           '/api/boult/v3/oauth/notion',
  notion_calendar:  '/api/boult/v3/oauth/notion', // shares Notion OAuth
};

interface ConnectorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  onTryOut?: (prompt: string) => void;
}

export function ConnectorsModal({ 
  isOpen,
  onClose,
  onConnect,
  onDisconnect,
  onTryOut
}: ConnectorsModalProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isDark = mounted && resolvedTheme === 'dark';

  const [statuses, setStatuses] = useState<any[]>([]);
  const [selectedApp, setSelectedApp] = useState<any | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [manageDropdownOpen, setManageDropdownOpen] = useState(false);
  // Cal.com connects by pasting an API key (cloud Cal.com has no OAuth app flow).
  const [calcomKey, setCalcomKey] = useState('');
  const [calcomConnecting, setCalcomConnecting] = useState(false);

  const connectCalcom = async () => {
    const key = calcomKey.trim();
    if (!key) { toast.error('Paste your Cal.com API key first.'); return; }
    setCalcomConnecting(true);
    try {
      const res = await fetch('/api/integrations/cal_com/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || 'Could not connect Cal.com.'); return; }
      toast.success('Cal.com connected.');
      setCalcomKey('');
      const r = await fetch('/api/integrations/status');
      if (r.ok) setStatuses((await r.json()).integrations || []);
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setCalcomConnecting(false);
    }
  };
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  // Check for successful auth redirect
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const success = params.get('success');
      const provider = params.get('provider');
      
      if (success === 'connected' && provider) {
        const app = SUPPORTED_APPS.find(a => a.id === provider);
        if (app) {
          setSelectedApp(app);
          setSuccessMessage('Connection Successful');
          setShowDetails(true);
          // Clear query params without reload
          window.history.replaceState({}, '', window.location.pathname);
        }
      }

      // Surface connection FAILURES too (previously silent — a denied consent
      // just bounced back with nothing shown). Covers the Composio callback
      // codes and the legacy own-client ones.
      const err = params.get('error');
      if (err) {
        const messages: Record<string, string> = {
          composio_denied: 'Connection was cancelled. Try again and approve access to continue.',
          composio_pending: 'The connection is still finishing on Google\'s side. Give it a moment and check again.',
          composio_no_pending: 'That connection attempt expired. Please start it again.',
          composio_callback: 'Something went wrong finishing the connection. Please try again.',
          token_exchange: 'Google sign-in didn\'t complete. Please try again.',
          db_store: 'We couldn\'t save the connection. Please try again.',
        };
        toast.error(messages[err] || 'That connection didn\'t complete. Please try again.');
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  const handleSendFeedback = async () => {
    if (!feedback.trim()) {
      return;
    }

    setIsSubmittingFeedback(true);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          feedback,
          source: `Integration: ${selectedApp?.name}`,
          connectorId: selectedApp?.id
        }),
      });

      if (response.ok) {
        setFeedback('');
        setShowFeedback(false);
      }
    } catch (error) {
      console.error('Failed to send feedback:', error);
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  // Fetch integration statuses — on mount and whenever modal opens
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/integrations/status');
      if (res.ok) {
        const data = await res.json();
        setStatuses(Array.isArray(data.integrations) ? data.integrations : []);
      }
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (isOpen) fetchStatus();
  }, [isOpen]);



  const handleConnectAction = async (appId: string) => {
    // V3 providers: just navigate — the route itself redirects to the provider
    if (V3_DIRECT_ROUTES[appId]) {
      window.location.assign(V3_DIRECT_ROUTES[appId]);
      return;
    }

    // Legacy providers: fetch a URL from the auth endpoint
    try {
      const res = await fetch(`/api/integrations/${appId}/auth`);
      if (res.ok) {
        const data = await res.json();
        if (data.url) { window.location.assign(data.url); return; }
      }
      toast.error('Authentication failed', { description: 'Please try again.' });
    } catch {
      toast.error('Could not reach authentication server', { description: 'Check your connection and try again.' });
    }
  };

  const handleDisconnect = async (appId: string) => {
    try {
      // PART 25: unified disconnect — clears all three token stores
      // (boult_integrations, integration_credentials, user_tokens) so the
      // chat layer correctly sees the connector as disconnected on next turn.
      const res = await fetch('/api/boult/connectors/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: appId }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Disconnect failed (${res.status})`);
      }
      // Refresh statuses
      const resStatus = await fetch('/api/integrations/status');
      if (resStatus.ok) {
        const data = await resStatus.json();
        setStatuses(data.integrations || []);
      }
      setSelectedApp(null);
      setManageDropdownOpen(false);
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  };

  if (!isOpen) return null;

  // Helper to check if an app is connected
  const isAppConnected = (appId: string) => {
    if (Array.isArray(statuses)) {
      return statuses.find((s: any) => s.provider === appId)?.connected;
    }
    return (statuses as any)?.[appId] === true || (statuses as any)?.[appId]?.connected === true;
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 md:p-8 isolate overflow-y-auto">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-md transition-all duration-500 z-0"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 30 }}
          animate={{ 
            opacity: 1, 
            scale: 1, 
            y: 0,
            filter: selectedApp ? 'blur(12px) brightness(0.5)' : 'none',
          }}
          exit={{ opacity: 0, scale: 0.98, y: 30 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className={cn(
            "relative w-full max-w-[920px] h-full max-h-[820px] rounded-[2.5rem] flex flex-col z-10",
            isDark 
              ? "bg-[#0A0A0A] border border-[#2A2A2A] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.8)]"
              : "bg-gradient-to-br from-[#FAFAFA] to-[#EBEBEB] border border-black/[0.08] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.15)]",
            selectedApp ? "pointer-events-none" : "pointer-events-auto"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-10 py-8">
            <h2 className={cn("text-[20px] font-bold tracking-tight", isDark ? "text-white" : "text-neutral-900")}>Connectors</h2>
            <button 
              onClick={onClose}
              className={cn(
                "p-1.5 rounded-lg transition-all",
                isDark 
                  ? "hover:bg-white/5 text-white/30 hover:text-white" 
                  : "hover:bg-black/5 text-neutral-400 hover:text-neutral-900"
              )}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation - Apps Only (Tabs removed) */}
          <div className={cn("px-10 flex items-center border-b", isDark ? "border-white/[0.03]" : "border-black/[0.05]")}>
            <button className={cn("pb-4 text-[14px] font-bold relative", isDark ? "text-white" : "text-neutral-900")}>
              Apps
              <motion.div 
                layoutId="tab-underline" 
                className={cn("absolute bottom-0 left-0 right-0 h-[3px] rounded-full", isDark ? "bg-white" : "bg-neutral-900")} 
              />
            </button>
          </div>

          {/* Grid Area */}
          <div className="flex-1 relative overflow-hidden">
            {/* Fade Overlays */}
            <div className={cn(
              "absolute top-0 left-0 right-0 h-12 z-10 pointer-events-none bg-gradient-to-b",
              isDark ? "from-[#0A0A0A] to-transparent" : "from-[#FAFAFA] to-transparent"
            )} />
            <div className={cn(
              "absolute bottom-0 left-0 right-0 h-12 z-10 pointer-events-none bg-gradient-to-t",
              isDark ? "from-[#0A0A0A] to-transparent" : "from-[#EBEBEB] to-transparent"
            )} />
            
            <div className="h-full overflow-y-auto p-10 py-12 boult-scrollbar pb-12">
            <div className="grid grid-cols-1 gap-4">
            {SUPPORTED_APPS.map((app) => {
                const isConnected = isAppConnected(app.id);

                return (
                  <button
                    key={app.id}
                    onClick={() => setSelectedApp(app)}
                    className={cn(
                      "flex items-start gap-6 p-6 rounded-[2rem] border transition-all text-left group shadow-sm",
                      isDark 
                        ? "bg-white/[0.02] border-white/5 hover:bg-white/10 hover:border-white/20" 
                        : "bg-[#F0F0F2] border-black/[0.04] hover:bg-[#E5E5E9] hover:border-black/[0.08]"
                    )}
                  >
                    <div 
                      className={cn(
                        "w-16 h-16 rounded-2xl flex items-center justify-center border shrink-0 shadow-lg group-hover:scale-110 transition-transform p-3",
                        isDark ? "border-white/[0.05]" : "border-black/[0.05]",
                        app.id === 'notion' 
                          ? (isDark ? "bg-white" : "bg-[#FAFAFA]") 
                          : (isDark ? "bg-black/40" : "bg-black/5")
                      )}
                    >
                      <app.icon className="w-full h-full" />
                    </div>
                    <div className="flex-1 pr-2">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-3">
                          <span className={cn("text-[15px] font-bold tracking-tight", isDark ? "text-white/90" : "text-neutral-900")}>{app.name}</span>
                          {app.comingSoon && (
                            <span className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              isDark ? "bg-white/10 text-white/40" : "bg-black/5 text-neutral-500"
                            )}>
                              Coming soon
                            </span>
                          )}
                        </div>
                        {isConnected && (
                          <span className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border",
                            isDark
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                              : "bg-emerald-50 border-emerald-200 text-emerald-600"
                          )}>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            Connected
                          </span>
                        )}
                      </div>
                      <p className={cn("text-[14px] leading-relaxed line-clamp-2 mt-1", isDark ? "text-white/40" : "text-neutral-500")}>
                        {app.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>
        {/* Sub Modal (App Detail View) */}
        <AnimatePresence>
          {selectedApp && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              className={cn(
                "absolute z-[20000] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(95vw,480px)] rounded-[3rem] p-8 md:p-10 flex flex-col items-center pointer-events-auto",
                isDark 
                  ? "bg-[#0A0A0A] border border-[#2A2A2A] shadow-[0_40px_120px_rgba(0,0,0,0.9)]"
                  : "bg-gradient-to-br from-[#FAFAFA] to-[#EBEBEB] border border-black/[0.08] shadow-[0_40px_120px_rgba(0,0,0,0.2)]"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button 
                onClick={() => {
                  setSelectedApp(null);
                  setSuccessMessage(null);
                  setShowDetails(false);
                  setManageDropdownOpen(false);
                }}
                className={cn(
                  "absolute top-6 right-6 p-2 rounded-full transition-all shadow-sm",
                  isDark 
                    ? "bg-white/5 hover:bg-white/10 text-white/20 hover:text-white" 
                    : "bg-black/5 hover:bg-black/10 text-neutral-400 hover:text-neutral-900"
                )}
              >
                <X className="w-5 h-5" />
              </button>

              {/* App Icon */}
              <div 
                className={cn(
                  "w-24 h-24 rounded-[28px] flex items-center justify-center border shadow-2xl mb-6 mt-4 p-5",
                  isDark ? "border-white/5" : "border-black/[0.05]",
                  selectedApp.id === 'notion' || selectedApp.id === 'cal_com' 
                    ? "bg-white" 
                    : (isDark ? "bg-black/60" : "bg-black/5")
                )}
              >
                <selectedApp.icon className="w-full h-full" />
              </div>

              {/* Connected badge — shows on successful redirect or when already connected */}
              {(isAppConnected(selectedApp.id) || successMessage) && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border",
                    isDark
                      ? "bg-emerald-500/10 border-emerald-500/20"
                      : "bg-emerald-50 border-emerald-200"
                  )}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className={cn("text-[12px] font-medium", isDark ? "text-emerald-400" : "text-emerald-600")}>
                    Connected
                  </span>
                </motion.div>
              )}

              <h3 className={cn("text-2xl font-bold mb-4 tracking-tight", isDark ? "text-white" : "text-neutral-900")}>{selectedApp.name}</h3>
              
              <p className={cn("text-[14px] leading-relaxed text-center mb-8 px-4", isDark ? "text-white/50" : "text-neutral-600")}>
                {selectedApp.description}
              </p>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 w-full mb-8">
                {isAppConnected(selectedApp.id) ? (
                  <>
                    <button
                      onClick={() => {
                        if (onTryOut) {
                          onTryOut(selectedApp.smartPrompt);
                          onClose();
                          setSelectedApp(null);
                        }
                      }}
                      className={cn(
                        "flex-1 py-4 rounded-2xl font-bold text-[15px] active:scale-95 transition-all flex items-center justify-center gap-2",
                        isDark 
                          ? "bg-white text-black hover:bg-white/90" 
                          : "bg-neutral-950 text-white hover:bg-neutral-800"
                      )}
                    >
                      <Zap className={cn("w-4 h-4", isDark ? "fill-black" : "fill-white")} />
                      Try it out
                    </button>
                    
                    <div className="relative flex-1">
                      <button
                        onClick={() => setManageDropdownOpen(!manageDropdownOpen)}
                        className={cn(
                          "w-full py-4 rounded-2xl font-bold text-[15px] active:scale-95 transition-all flex items-center justify-center gap-2",
                          isDark 
                            ? "bg-[#232323] text-white hover:bg-[#2A2A2A]" 
                            : "bg-[#F0F0F2] border border-black/[0.06] text-neutral-850 rounded-2xl font-bold text-[15px] hover:bg-[#E5E5E9]"
                        )}
                      >
                        Manage
                        <ChevronDown className={cn("w-4 h-4 transition-transform", manageDropdownOpen && "rotate-180")} />
                      </button>

                      {/* Manage Dropdown */}
                      <AnimatePresence>
                        {manageDropdownOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className={cn(
                              "absolute bottom-full mb-3 left-0 right-0 rounded-2xl shadow-2xl overflow-hidden z-[220]",
                              isDark 
                                ? "bg-[#1A1A1A] border border-[#2A2A2A]" 
                                : "bg-white border border-black/[0.08]"
                            )}
                          >
                            <button className={cn(
                              "w-full px-4 py-3 text-left text-[14px] font-medium flex items-center gap-3 transition-all",
                              isDark 
                                ? "text-white/70 hover:bg-white/5 hover:text-white" 
                                : "text-neutral-600 hover:bg-black/5 hover:text-neutral-900"
                            )}>
                              <Plus className="w-4 h-4" />
                              Configure
                            </button>
                            <button 
                              onClick={() => handleDisconnect(selectedApp.id)}
                              className={cn(
                                "w-full px-4 py-3 text-left text-[14px] font-medium flex items-center gap-3 transition-all border-t",
                                isDark 
                                  ? "text-red-400 hover:bg-red-500/10 border-white/[0.03]" 
                                  : "text-red-650 hover:bg-red-500/5 border-black/[0.04]"
                              )}
                            >
                              <X className="w-4 h-4" />
                              Delete
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </>
                ) : selectedApp.comingSoon ? (
                  <button
                    disabled
                    className={cn(
                      "w-full py-4 rounded-2xl font-bold text-[15px] cursor-not-allowed flex items-center justify-center gap-2",
                      isDark 
                        ? "bg-white/10 text-white/40" 
                        : "bg-black/5 text-neutral-400"
                    )}
                  >
                    <Clock className="w-4 h-4" />
                    Coming soon
                  </button>
                ) : selectedApp.id === 'cal_com' ? (
                  <div className="w-full flex flex-col gap-3">
                    {/* Step 1 — one click straight to the right page */}
                    <a
                      href="https://app.cal.com/settings/developer/api-keys?createKey=Maily"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "w-full py-3.5 rounded-2xl font-bold text-[14px] flex items-center justify-center gap-2 transition-all active:scale-95 border",
                        isDark
                          ? "bg-white/[0.06] text-white hover:bg-white/[0.1] border-white/10"
                          : "bg-black/[0.04] text-neutral-900 hover:bg-black/[0.07] border-black/10"
                      )}
                    >
                      <ExternalLink className="w-4 h-4" /> Open Cal.com → create your key
                    </a>

                    {/* The 3 steps, spelled out so there's nothing to figure out */}
                    <ol className={cn("text-[12.5px] leading-relaxed list-decimal pl-5 space-y-1", isDark ? "text-white/55" : "text-neutral-600")}>
                      <li>On the page that opens, click <span className="font-semibold">+ Add</span> → name it <span className="font-semibold">Maily</span> → <span className="font-semibold">Save</span>.</li>
                      <li>Copy the key it shows (starts with <span className="font-mono">cal_</span>).</li>
                      <li>Paste it below and hit Connect.</li>
                    </ol>

                    <input
                      type="password"
                      value={calcomKey}
                      onChange={(e) => setCalcomKey(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') connectCalcom(); }}
                      placeholder="Paste your key (cal_…)"
                      className={cn(
                        "w-full px-4 py-3.5 rounded-2xl border text-[14px] font-medium focus:outline-none transition-all",
                        isDark
                          ? "bg-white/[0.04] border-white/10 text-white placeholder:text-white/30 focus:border-white/25"
                          : "bg-black/[0.03] border-black/10 text-neutral-900 placeholder:text-neutral-400 focus:border-black/25"
                      )}
                    />
                    <button
                      onClick={connectCalcom}
                      disabled={calcomConnecting}
                      className={cn(
                        "w-full py-4 rounded-2xl font-bold text-[15px] active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50",
                        isDark ? "bg-white text-black hover:bg-white/90" : "bg-neutral-950 text-white hover:bg-neutral-800"
                      )}
                    >
                      {calcomConnecting ? 'Connecting…' : <><Zap className={cn("w-4 h-4", isDark ? "fill-black" : "fill-white")} /> Connect Cal.com</>}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleConnectAction(selectedApp.id)}
                    className={cn(
                      "w-full py-4 rounded-2xl font-bold text-[15px] active:scale-95 transition-all flex items-center justify-center gap-2",
                      isDark
                        ? "bg-white text-black hover:bg-white/90"
                        : "bg-neutral-950 text-white hover:bg-neutral-800"
                    )}
                  >
                    <Zap className={cn("w-4 h-4", isDark ? "fill-black" : "fill-white")} />
                    Connect
                  </button>
                )}
              </div>

              {/* Details Accordion */}
              <div className={cn("w-full border-t pt-4", isDark ? "border-white/[0.05]" : "border-black/[0.05]")}>
                <button 
                  onClick={() => setShowDetails(!showDetails)}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 py-2 transition-all text-[13px] font-medium mb-4",
                    isDark ? "text-white/30 hover:text-white/60" : "text-neutral-400 hover:text-neutral-700"
                  )}
                >
                  {showDetails ? 'Hide Details' : 'Show Details'}
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showDetails && "rotate-180")} />
                </button>

                <AnimatePresence>
                  {showDetails && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className={cn(
                        "rounded-3xl p-6 border space-y-4 mb-2",
                        isDark 
                          ? "bg-black/20 border-white/[0.03]" 
                          : "bg-black/[0.02] border-black/[0.04]"
                      )}>
                        <div className="flex items-center justify-between">
                          <span className={cn("text-[13px]", isDark ? "text-white/30" : "text-neutral-400")}>Connector Type</span>
                          <span className={cn("text-[13px] font-medium", isDark ? "text-white/70" : "text-neutral-800")}>{selectedApp.type}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={cn("text-[13px]", isDark ? "text-white/30" : "text-neutral-400")}>Author</span>
                          <span className={cn("text-[13px] font-medium", isDark ? "text-white/70" : "text-neutral-800")}>{selectedApp.author}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={cn("text-[13px]", isDark ? "text-white/30" : "text-neutral-400")}>UUID</span>
                          <div className="flex items-center gap-2">
                            <span className={cn("font-mono text-[11px] truncate max-w-[120px]", isDark ? "text-white/40" : "text-neutral-500")}>{selectedApp.uuid}</span>
                            <button className={cn("transition-all", isDark ? "text-white/20 hover:text-white" : "text-neutral-400 hover:text-neutral-800")}><Plus className="w-3.5 h-3.5 rotate-45" /></button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={cn("text-[13px]", isDark ? "text-white/30" : "text-neutral-400")}>Website</span>
                          <a href={selectedApp.website} target="_blank" className={cn("transition-all", isDark ? "text-white/20 hover:text-white" : "text-neutral-400 hover:text-neutral-800")}><ExternalLink className="w-3.5 h-3.5" /></a>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={cn("text-[13px]", isDark ? "text-white/30" : "text-neutral-400")}>Documentation</span>
                          <a href={selectedApp.documentation} target="_blank" className={cn("transition-all", isDark ? "text-white/20 hover:text-white" : "text-neutral-400 hover:text-neutral-800")}><ExternalLink className="w-3.5 h-3.5" /></a>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={cn("text-[13px]", isDark ? "text-white/30" : "text-neutral-400")}>Privacy Policy</span>
                          <a href={selectedApp.privacyPolicy} target="_blank" className={cn("transition-all", isDark ? "text-white/20 hover:text-white" : "text-neutral-400 hover:text-neutral-800")}><ExternalLink className="w-3.5 h-3.5" /></a>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                
                <div className="flex justify-center mt-6">
                  <button 
                    onClick={() => setShowFeedback(true)}
                    className={cn(
                      "text-[13px] transition-all underline underline-offset-4",
                      isDark ? "text-white/45 hover:text-white/70" : "text-neutral-500 hover:text-neutral-800"
                    )}
                  >
                    Provide feedback
                  </button>
                </div>
              </div>

              {/* Feedback Overlay */}
              <AnimatePresence>
                {showFeedback && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={cn(
                      "absolute inset-0 z-[30000] backdrop-blur-sm flex items-center justify-center p-6 rounded-[2.5rem]",
                      isDark ? "bg-black/40" : "bg-black/20"
                    )}
                  >
                    <motion.div 
                      initial={{ y: 20 }}
                      animate={{ y: 0 }}
                      className={cn(
                        "w-full max-w-[420px] rounded-[2rem] p-8 shadow-2xl flex flex-col gap-6",
                        isDark 
                          ? "bg-[#141414] border border-[#2A2A2A]" 
                          : "bg-gradient-to-br from-[#FAFAFA] to-[#EBEBEB] border border-black/[0.08]"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <h3 className={cn("text-[15px] font-bold", isDark ? "text-white/90" : "text-neutral-900")}>Feedback for {selectedApp.name}</h3>
                        <button 
                          onClick={() => setShowFeedback(false)}
                          className={cn("p-1 transition-colors", isDark ? "text-white/30 hover:text-white" : "text-neutral-400 hover:text-neutral-900")}
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="relative">
                        <textarea
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                          placeholder="Share your thoughts..."
                          className={cn(
                            "w-full h-40 rounded-2xl p-5 text-[14px] placeholder:text-neutral-400 focus:outline-none transition-all resize-none leading-relaxed",
                            isDark 
                              ? "bg-white/[0.03] border border-white/5 text-white placeholder:text-white/20 focus:border-white/10" 
                              : "bg-[#F0F0F2] border border-black/[0.06] text-neutral-900 placeholder:text-black/25 focus:border-black/15"
                          )}
                          autoFocus
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                              handleSendFeedback();
                            }
                          }}
                        />
                      </div>

                      <div className="flex justify-end">
                        <button 
                          onClick={handleSendFeedback}
                          disabled={isSubmittingFeedback || !feedback.trim()}
                          className={cn(
                            "rounded-full pl-6 pr-4 py-3 text-[14px] font-bold flex items-center gap-4 active:scale-95 transition-all disabled:opacity-20 disabled:grayscale disabled:cursor-not-allowed group",
                            isDark 
                              ? "bg-white/10 hover:bg-white/20 text-white" 
                              : "bg-neutral-950 hover:bg-neutral-800 text-white"
                          )}
                        >
                          {isSubmittingFeedback ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <>
                              Send Feedback
                              <div className="flex items-center gap-1 bg-white/20 px-2 py-1 rounded-md text-[10px] text-white/60">
                                <span>⌘</span>
                                <span className="text-[12px]">↵</span>
                              </div>
                            </>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AnimatePresence>

  );
}

export default ConnectorsModal;
