'use client'

import { useState } from 'react'

interface ContactMethod {
  icon: React.ReactNode
  contact: string
}

export default function Contact() {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    company: '',
    message: ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const contactMethods: ContactMethod[] = [
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      ),
      contact: "support.maily@gmail.com"
    }
  ]

  const socialMethods = [
    {
      type: 'separator',
      content: 'OR'
    },
    {
      type: 'social',
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      ),
      link: 'https://github.com/maily-cfd/Maily'
    },
    {
      type: 'social',
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
      link: 'https://x.com/Mailycfd'
    }
  ]

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500))

    setIsSubmitting(false)
    setSubmitted(true)

    // Reset form after 3 seconds
    setTimeout(() => {
      setSubmitted(false)
      setFormData({ fullName: '', email: '', company: '', message: '' })
    }, 3000)
  }

  return (
    <main className="min-h-screen bg-black py-14">
      <div className="max-w-screen-xl mx-auto px-4 text-white md:px-8">
        <div className="max-w-lg mx-auto gap-12 justify-between lg:flex lg:max-w-none">
          <div className="max-w-lg space-y-3">
            <h3 className="text-white font-semibold">
              Contact
            </h3>
            <p className="text-white text-3xl font-semibold sm:text-4xl">
              Let us know how we can help
            </p>
            <p className="text-neutral-900 dark:text-gray-300">
              We're here to help and answer any question you might have about Maily's email management platform. We look forward to hearing from you! Please fill out the form, or use the contact information below.
            </p>
            <div>
              <ul className="mt-6 flex flex-wrap gap-x-10 gap-y-6 items-center">
                {
                  contactMethods.map((item, idx) => (
                    <li key={idx} className="flex items-center gap-x-3">
                      <div className="flex-none text-neutral-600 dark:text-gray-400">
                        {item.icon}
                      </div>
                      <p className="text-neutral-900 dark:text-gray-300">{item.contact}</p>
                    </li>
                  ))
                }
                {socialMethods.map((item, idx) => {
                  if (item.type === 'separator') {
                    return (
                      <li key={idx} className="flex items-center">
                        <span className="text-white font-medium">{item.content}</span>
                      </li>
                    )
                  }
                  return (
                    <li key={idx} className="flex items-center gap-x-3">
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-none text-neutral-600 dark:text-gray-400 hover:text-white transition-colors duration-200"
                      >
                        {item.icon}
                      </a>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
          <div className="flex-1 mt-12 sm:max-w-lg lg:max-w-md">
            <form
              onSubmit={handleSubmit}
              className="space-y-5"
            >
              <div>
                <label className="font-medium text-white">
                  Full name
                </label>
                <input
                  type="text"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleInputChange}
                  required
                  className="w-full mt-2 px-3 py-2 text-white bg-neutral-50 dark:bg-[#1F2023] outline-none border border-gray-600 focus:border-gray-500 shadow-sm rounded-lg placeholder-gray-400"
                  placeholder="Your full name"
                />
              </div>
              <div>
                <label className="font-medium text-white">
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  className="w-full mt-2 px-3 py-2 text-white bg-neutral-50 dark:bg-[#1F2023] outline-none border border-gray-600 focus:border-gray-500 shadow-sm rounded-lg placeholder-gray-400"
                  placeholder="your.email@company.com"
                />
              </div>
              <div>
                <label className="font-medium text-white">
                  Company
                </label>
                <input
                  type="text"
                  name="company"
                  value={formData.company}
                  onChange={handleInputChange}
                  required
                  className="w-full mt-2 px-3 py-2 text-white bg-neutral-50 dark:bg-[#1F2023] outline-none border border-gray-600 focus:border-gray-500 shadow-sm rounded-lg placeholder-gray-400"
                  placeholder="Company name"
                />
              </div>
              <div>
                <label className="font-medium text-white">
                  Message
                </label>
                <textarea
                  name="message"
                  value={formData.message}
                  onChange={handleInputChange}
                  required
                  className="w-full mt-2 h-36 px-3 py-2 resize-none appearance-none text-white bg-neutral-50 dark:bg-[#1F2023] outline-none border border-gray-600 focus:border-gray-500 shadow-sm rounded-lg placeholder-gray-400"
                  placeholder="Tell us about your email management needs..."
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full px-4 py-2 text-black font-medium bg-white hover:bg-gray-100 active:bg-gray-200 rounded-lg duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Sending...' : 'Submit'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Success Overlay */}
      {submitted && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-neutral-50 dark:bg-gray-900/90 border border-green-500/50 rounded-2xl p-8 text-center max-w-md mx-4 shadow-2xl">
            <div className="w-16 h-16 bg-gradient-to-r from-green-500 to-cyan-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-white mb-2">Message Sent!</h3>
            <p className="text-neutral-900 dark:text-gray-300">Thank you for reaching out. Our team will contact you within 24 hours.</p>
          </div>
        </div>
      )}
    </main>
  )
}
